/**
 * TEST DE CONCURRENCE — à lancer UNIQUEMENT sur une base de test jetable.
 *
 * Chaque scénario lance N appels SIMULTANÉS sur la même ressource, puis vérifie en base
 * que l'argent / les places ne sont comptés qu'une seule fois.
 *
 * Usage :  DATABASE_URL=postgresql://...test... npx ts-node scripts/concurrency-test.ts
 */
import { prisma } from '../src/lib/prisma';
import { holdFunds, releaseFunds, refundFunds, confirmSide } from '../src/services/escrow.service';
import { confirmDeposit } from '../src/services/payment.service';
import { redeemLoyaltyPoints, addLoyaltyPoints } from '../src/services/loyalty.service';

// Garde-fou : refuse de tourner sur autre chose qu'une base de test locale
const url = process.env.DATABASE_URL || '';
if (!/localhost:55432\/go237test/.test(url)) {
  console.error('REFUS : ce script ne tourne que sur la base de test localhost:55432/go237test');
  process.exit(1);
}

const N = 20; // appels simultanés par scénario
let failures = 0;

// Identifiants de service UNIQUES par exécution : sinon un lancement précédent laisse des
// escrows en base et fausse les comptages (constaté lors de la première mise au point).
const RUN = Date.now().toString(16).slice(-8).padStart(8, '0');
const sid = (suffix: string) => `${RUN}-0000-4000-8000-${suffix.padStart(12, '0')}`;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
  if (!ok) failures++;
}

let counter = 0;
async function makeUser(balance: number, points = 0) {
  counter++;
  return prisma.user.create({
    data: {
      phone: `69${String(Date.now()).slice(-6)}${counter}`.slice(0, 15),
      firstName: 'Test',
      lastName: `U${counter}`,
      wallet: { create: { balance } },
      loyaltyPoints: { create: { points } },
    },
    include: { wallet: true },
  });
}

const balanceOf = async (userId: string) =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

async function main() {
  // 1) RETRAIT : solde 1000, 20 retraits simultanés de 1000 → un seul doit passer
  {
    const u = await makeUser(1000);
    const attempt = () =>
      prisma.$transaction(async (tx) => {
        const r = await tx.wallet.updateMany({
          where: { id: u.wallet!.id, balance: { gte: 1000 } },
          data: { balance: { decrement: 1000 } },
        });
        if (r.count !== 1) throw new Error('insuffisant');
        await tx.transaction.create({
          data: { walletId: u.wallet!.id, type: 'WITHDRAWAL', amount: 1000, paymentMethod: 'MTN_MOMO', status: 'PENDING' },
        });
      });
    const res = await Promise.allSettled(Array.from({ length: N }, attempt));
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const bal = await balanceOf(u.id);
    check('Retrait simultané', ok === 1 && bal === 0, `${ok} retrait(s) accepté(s), solde final ${bal} (attendu : 1 et 0)`);
  }

  // 2) BLOCAGE ESCROW : solde 1000, 20 réservations simultanées de 1000 (services différents)
  {
    const payer = await makeUser(1000);
    const payee = await makeUser(0);
    const res = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        holdFunds({
          amount: 1000, payerId: payer.id, payeeId: payee.id,
          paymentMethod: 'WALLET', serviceType: 'RIDE', serviceId: sid(`1${i}`),
        })
      )
    );
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const bal = await balanceOf(payer.id);
    check('Blocage escrow simultané', ok === 1 && bal === 0, `${ok} blocage(s) accepté(s), solde final ${bal} (attendu : 1 et 0)`);
  }

  // 3) DOUBLE BLOCAGE SUR LE MÊME SERVICE : un seul escrow doit être créé
  {
    const payer = await makeUser(100000);
    const payee = await makeUser(0);
    const id3 = sid('3');
    await Promise.allSettled(
      Array.from({ length: N }, () =>
        holdFunds({ amount: 1000, payerId: payer.id, payeeId: payee.id, paymentMethod: 'WALLET', serviceType: 'DELIVERY', serviceId: id3 })
      )
    );
    const count = await prisma.escrow.count({ where: { serviceType: 'DELIVERY', serviceId: id3 } });
    const bal = await balanceOf(payer.id);
    check('Double blocage même service', count === 1 && bal === 99000, `${count} escrow(s) créé(s), solde ${bal} (attendu : 1 et 99000)`);
  }

  // 4) LIBÉRATION : 20 libérations simultanées du même escrow → prestataire payé UNE fois
  {
    const payer = await makeUser(10000);
    const payee = await makeUser(0);
    const e = await holdFunds({
      amount: 10000, payerId: payer.id, payeeId: payee.id,
      paymentMethod: 'WALLET', serviceType: 'MARKET', serviceId: sid('4'),
    });
    const res = await Promise.allSettled(Array.from({ length: N }, () => releaseFunds(e.id, 'auto')));
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const bal = await balanceOf(payee.id);
    check('Libération simultanée', ok === 1 && bal === 8500, `${ok} libération(s), prestataire crédité de ${bal} (attendu : 1 et 8500)`);
  }

  // 5) LIBÉRATION vs REMBOURSEMENT en même temps → un seul des deux gagne
  {
    const payer = await makeUser(10000);
    const payee = await makeUser(0);
    const e = await holdFunds({
      amount: 10000, payerId: payer.id, payeeId: payee.id,
      paymentMethod: 'WALLET', serviceType: 'RENTAL', serviceId: sid('5'),
    });
    await Promise.allSettled([
      ...Array.from({ length: N / 2 }, () => releaseFunds(e.id, 'auto')),
      ...Array.from({ length: N / 2 }, () => refundFunds(e.id, 'auto')),
    ]);
    const payerBal = await balanceOf(payer.id);
    const payeeBal = await balanceOf(payee.id);
    const total = payerBal + payeeBal;
    const valid = (payerBal === 10000 && payeeBal === 0) || (payerBal === 0 && payeeBal === 8500);
    check('Libération vs remboursement', valid, `client ${payerBal}, prestataire ${payeeBal} (total ${total}) — un seul gagnant attendu`);
  }

  // 6) DOUBLE CONFIRMATION client + prestataire en même temps → payé une seule fois
  {
    const payer = await makeUser(10000);
    const payee = await makeUser(0);
    const id6 = sid('6');
    await holdFunds({ amount: 10000, payerId: payer.id, payeeId: payee.id, paymentMethod: 'WALLET', serviceType: 'RIDE', serviceId: id6 });
    await Promise.allSettled([
      ...Array.from({ length: N / 2 }, () => confirmSide('RIDE', id6, 'client', payer.id)),
      ...Array.from({ length: N / 2 }, () => confirmSide('RIDE', id6, 'provider', payee.id)),
    ]);
    const bal = await balanceOf(payee.id);
    const esc = await prisma.escrow.findFirst({ where: { serviceType: 'RIDE', serviceId: id6 } });
    check('Double confirmation simultanée', bal === 8500 && esc?.status === 'RELEASED', `prestataire ${bal}, escrow ${esc?.status} (attendu : 8500 et RELEASED)`);
  }

  // 7) DÉPÔT : webhook + vérification de l'app en même temps → crédité une seule fois
  {
    const u = await makeUser(0);
    const tx = await prisma.transaction.create({
      data: { walletId: u.wallet!.id, type: 'DEPOSIT', amount: 5000, paymentMethod: 'MTN_MOMO', status: 'PENDING', reference: `dep-${Date.now()}`, metadata: { bonus: 250 } },
    });
    await Promise.allSettled(Array.from({ length: N }, () => confirmDeposit(tx.reference!)));
    const bal = await balanceOf(u.id);
    check('Dépôt confirmé en double', bal === 5250, `solde ${bal} (attendu : 5250 = 5000 + bonus 250)`);
  }

  // 8) POINTS : 500 points, 20 échanges simultanés de 500 → un seul passe
  {
    const u = await makeUser(0, 500);
    const res = await Promise.allSettled(Array.from({ length: N }, () => redeemLoyaltyPoints(u.id, 500)));
    const ok = res.filter((r) => r.status === 'fulfilled' && r.value !== null).length;
    const pts = (await prisma.loyaltyPoints.findUniqueOrThrow({ where: { userId: u.id } })).points;
    check('Échange de points simultané', ok === 1 && pts === 0, `${ok} échange(s) accepté(s), points restants ${pts} (attendu : 1 et 0)`);
  }

  // 9) GAIN DE POINTS : 20 gains simultanés de 10 → aucun ne doit être perdu
  {
    const u = await makeUser(0, 0);
    await Promise.allSettled(Array.from({ length: N }, () => addLoyaltyPoints(u.id, 10)));
    const pts = (await prisma.loyaltyPoints.findUniqueOrThrow({ where: { userId: u.id } })).points;
    check('Gain de points simultané', pts === N * 10, `points ${pts} (attendu : ${N * 10})`);
  }

  // 10) COURSE : 20 chauffeurs acceptent la même course → un seul l'obtient
  {
    const passenger = await makeUser(0);
    const drivers = await Promise.all(Array.from({ length: N }, () => makeUser(0)));
    const ride = await prisma.ride.create({
      data: {
        passengerId: passenger.id, vehicleType: 'MOTO',
        pickupLat: 4.05, pickupLng: 9.76, pickupAddress: 'A', dropoffLat: 4.06, dropoffLng: 9.78, dropoffAddress: 'B',
        estimatedPrice: 1000, paymentMethod: 'CASH',
      },
    });
    const res = await Promise.all(
      drivers.map((d) =>
        prisma.ride.updateMany({ where: { id: ride.id, status: 'PENDING', driverId: null }, data: { driverId: d.id, status: 'ACCEPTED' } })
      )
    );
    const winners = res.filter((r) => r.count === 1).length;
    check('Course acceptée par plusieurs chauffeurs', winners === 1, `${winners} chauffeur(s) l'ont obtenue (attendu : 1)`);
  }

  // 11) COVOITURAGE : 1 place, 20 passagers simultanés → un seul obtient la place
  {
    const driver = await makeUser(0);
    const carpool = await prisma.carpool.create({
      data: {
        driverId: driver.id, departureLat: 4.05, departureLng: 9.76, departureCity: 'Douala', departureAddress: 'A',
        arrivalLat: 3.86, arrivalLng: 11.5, arrivalCity: 'Yaoundé', arrivalAddress: 'B',
        departureTime: new Date(Date.now() + 86400000), availableSeats: 1, pricePerSeat: 5000,
      },
    });
    const res = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.carpool.updateMany({ where: { id: carpool.id, status: 'ACTIVE', availableSeats: { gte: 1 } }, data: { availableSeats: { decrement: 1 } } })
      )
    );
    const winners = res.filter((r) => r.count === 1).length;
    const seats = (await prisma.carpool.findUniqueOrThrow({ where: { id: carpool.id } })).availableSeats;
    check('Dernière place de covoiturage', winners === 1 && seats === 0, `${winners} réservation(s), places restantes ${seats} (attendu : 1 et 0)`);
  }

  // 12) LOCATION : 20 réservations simultanées des mêmes dates → une seule
  {
    const owner = await makeUser(0);
    const vehicle = await prisma.vehicle.create({
      data: {
        ownerId: owner.id, type: 'CAR_ECONOMY', brand: 'Toyota', model: 'Corolla', year: 2018, plate: `LT-${Date.now()}`,
        pricePerDay: 20000, locationLat: 4.05, locationLng: 9.76, locationAddress: 'Douala', verificationStatus: 'VERIFIED',
      },
    });
    const renters = await Promise.all(Array.from({ length: N }, () => makeUser(0)));
    const start = new Date('2027-01-10');
    const end = new Date('2027-01-12');
    const res = await Promise.allSettled(
      renters.map((r) =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "vehicles" WHERE id = ${vehicle.id} FOR UPDATE`;
          const conflict = await tx.rentalBooking.findFirst({
            where: { vehicleId: vehicle.id, status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] }, startDate: { lte: end }, endDate: { gte: start } },
          });
          if (conflict) throw new Error('conflit');
          return tx.rentalBooking.create({
            data: { vehicleId: vehicle.id, renterId: r.id, startDate: start, endDate: end, totalPrice: 40000, paymentMethod: 'CASH', status: 'CONFIRMED' },
          });
        })
      )
    );
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const count = await prisma.rentalBooking.count({ where: { vehicleId: vehicle.id } });
    check('Location aux mêmes dates', ok === 1 && count === 1, `${ok} réservation(s) acceptée(s), ${count} en base (attendu : 1 et 1)`);
  }

  console.log(`\n${failures === 0 ? '✅ TOUS LES SCÉNARIOS PASSENT' : `❌ ${failures} scénario(s) en échec`}`);
}

main()
  .catch((e) => {
    console.error('Erreur du script :', e);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
