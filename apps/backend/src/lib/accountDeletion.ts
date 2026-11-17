/**
 * SUPPRESSION DE COMPTE PAR L'UTILISATEUR (exigée par Google Play)
 *
 * Ce qui est fait :
 *  - les données personnelles sont EFFACÉES : nom, téléphone, email, photo, mot de passe,
 *    contacts d'urgence, notifications, jeton de notification, documents d'identité (fichiers
 *    compris), position ;
 *  - l'historique (courses, paiements, notes, messages) est CONSERVÉ mais ANONYMISÉ
 *    (« Compte supprimé ») : il est nécessaire à la comptabilité, aux litiges de l'autre partie
 *    et aux obligations légales. Le supprimer casserait aussi les comptes des autres utilisateurs ;
 *  - la boutique, les véhicules et le profil chauffeur sont retirés de l'app ;
 *  - toutes les sessions sont fermées, le numéro de téléphone redevient libre.
 *
 * Refusé tant que de l'argent ou un service est en cours (sinon l'utilisateur ou l'autre partie
 * perdrait de l'argent) : course, livraison, commande, location, covoiturage, paiement bloqué,
 * litige, retrait en attente, solde à retirer.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { PRIVATE_DIR } from './uploadPaths';

/** Solde minimum de retrait : en dessous, l'utilisateur ne peut pas retirer, il peut y renoncer. */
export const MIN_WITHDRAWAL = 500;

export interface DeletionBlocker {
  code: string;
  message: string;
}

export async function deletionBlockers(userId: string): Promise<{ blockers: DeletionBlocker[]; balance: number }> {
  const [
    user, rides, deliveries, ordersAsCustomer, ordersAsMerchant, carpools, carpoolBookings,
    rentalsAsRenter, rentalsAsOwner, escrows, pendingWithdrawals, wallet,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.ride.count({
      where: { OR: [{ passengerId: userId }, { driverId: userId }], status: { in: ['PENDING', 'ACCEPTED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } },
    }),
    prisma.delivery.count({
      where: { OR: [{ senderId: userId }, { driverId: userId }], status: { in: ['PENDING', 'ACCEPTED', 'PICKING_UP', 'IN_TRANSIT'] } },
    }),
    prisma.marketOrder.count({ where: { customerId: userId, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
    prisma.marketOrder.count({ where: { merchant: { userId }, status: { notIn: ['DELIVERED', 'CANCELLED'] } } }),
    prisma.carpool.count({ where: { driverId: userId, status: { in: ['ACTIVE', 'FULL', 'DEPARTED'] }, bookings: { some: { status: { in: ['PENDING', 'CONFIRMED'] } } } } }),
    prisma.carpoolBooking.count({ where: { passengerId: userId, status: { in: ['PENDING', 'CONFIRMED'] } } }),
    prisma.rentalBooking.count({ where: { renterId: userId, status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] } } }),
    prisma.rentalBooking.count({ where: { vehicle: { ownerId: userId }, status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] } } }),
    prisma.escrow.count({ where: { OR: [{ payerId: userId }, { payeeId: userId }], status: { in: ['HELD', 'DISPUTED'] } } }),
    prisma.transaction.count({ where: { wallet: { userId }, type: 'WITHDRAWAL', status: 'PENDING' } }),
    prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
  ]);

  const blockers: DeletionBlocker[] = [];
  const add = (n: number, code: string, message: string) => { if (n > 0) blockers.push({ code, message }); };

  if (user?.role === 'ADMIN') {
    blockers.push({ code: 'ADMIN', message: 'Un compte administrateur ne peut pas être supprimé depuis l\'application.' });
  }
  add(rides, 'RIDE', 'Vous avez une course en cours. Terminez-la ou annulez-la d\'abord.');
  add(deliveries, 'DELIVERY', 'Vous avez une livraison en cours. Terminez-la ou annulez-la d\'abord.');
  add(ordersAsCustomer, 'ORDER', 'Vous avez une commande GO Market en cours.');
  add(ordersAsMerchant, 'SHOP_ORDER', 'Votre boutique a des commandes en cours : livrez-les ou annulez-les d\'abord.');
  add(carpools, 'CARPOOL', 'Vous avez un trajet de covoiturage avec des passagers réservés.');
  add(carpoolBookings, 'CARPOOL_BOOKING', 'Vous avez une réservation de covoiturage en cours.');
  add(rentalsAsRenter, 'RENTAL', 'Vous avez une location de véhicule en cours.');
  add(rentalsAsOwner, 'RENTAL_OWNER', 'Un de vos véhicules a une location en cours.');
  add(escrows, 'ESCROW', 'Un paiement est encore bloqué ou en litige sur un de vos services. Attendez sa fin.');
  add(pendingWithdrawals, 'WITHDRAWAL', 'Un retrait est en attente de versement. Attendez de l\'avoir reçu.');

  const balance = wallet?.balance ?? 0;
  if (balance >= MIN_WITHDRAWAL) {
    blockers.push({
      code: 'BALANCE',
      message: `Il reste ${Math.floor(balance).toLocaleString('fr-FR')} F sur votre portefeuille. Retirez-les d'abord (Portefeuille → Retirer).`,
    });
  }
  return { blockers, balance };
}

/** Efface les fichiers de documents d'identité du compte (nommés « <userId>--… »). */
function deletePrivateFiles(userId: string): number {
  let n = 0;
  try {
    for (const name of fs.readdirSync(PRIVATE_DIR)) {
      if (name.toLowerCase().startsWith(`${userId.toLowerCase()}--`)) {
        try {
          fs.unlinkSync(path.join(PRIVATE_DIR, name));
          n++;
        } catch { /* fichier déjà absent */ }
      }
    }
  } catch { /* dossier absent */ }
  return n;
}

/** Anonymise le compte. À n'appeler qu'après avoir vérifié deletionBlockers(). */
export async function anonymizeAccount(userId: string, forfeitedBalance: number): Promise<void> {
  const tag = `supprime-${randomUUID()}`; // libère le numéro, reste unique
  const ANON = 'supprimé';

  await prisma.$transaction(async (tx) => {
    await tx.emergencyContact.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.businessMember.deleteMany({ where: { userId } });

    // Petit solde (sous le minimum de retrait) auquel l'utilisateur a renoncé : tracé
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (wallet && forfeitedBalance > 0) {
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: 0 } });
      await tx.transaction.create({
        data: {
          walletId: wallet.id, type: 'WITHDRAWAL', amount: forfeitedBalance, paymentMethod: 'WALLET', status: 'CANCELLED',
          description: 'Solde abandonné à la suppression du compte (inférieur au minimum de retrait)',
        },
      });
    }

    await tx.driverProfile.updateMany({
      where: { userId },
      data: {
        isOnline: false, currentLat: null, currentLng: null, verificationStatus: 'REJECTED',
        licenseNumber: ANON, cniNumber: ANON, vehiclePlate: ANON,
        licensePhoto: null, cniPhoto: null, vehiclePhoto: null, registrationPhoto: null, insurancePhoto: null, inspectionPhoto: null,
      },
    });

    const shop = await tx.merchantProfile.findUnique({ where: { userId }, select: { id: true } });
    if (shop) {
      await tx.merchantProfile.update({
        where: { id: shop.id },
        data: { isOpen: false, verificationStatus: 'REJECTED', ownerIdPhoto: null, businessRegPhoto: null, rejectionReason: 'Compte supprimé' },
      });
      await tx.product.updateMany({ where: { merchantId: shop.id }, data: { isAvailable: false } });
    }

    await tx.vehicle.updateMany({
      where: { ownerId: userId },
      data: {
        isAvailable: false, verificationStatus: 'REJECTED', rejectionReason: 'Compte supprimé',
        registrationPhoto: null, insurancePhoto: null, ownerIdPhoto: null, localContactName: null, localContactPhone: null,
      },
    });
    // Covoiturages futurs sans passager : retirés
    await tx.carpool.updateMany({ where: { driverId: userId, status: { in: ['ACTIVE', 'FULL'] } }, data: { status: 'CANCELLED' } });

    await tx.user.update({
      where: { id: userId },
      data: {
        phone: tag,
        email: null,
        firstName: 'Compte',
        lastName: ANON,
        passwordHash: null,
        resetOtp: null, resetOtpExpiry: null,
        twoFaCode: null, twoFaExpiry: null,
        pushToken: null,
        avatar: null,
        isActive: false,
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    });
  });

  deletePrivateFiles(userId);
}
