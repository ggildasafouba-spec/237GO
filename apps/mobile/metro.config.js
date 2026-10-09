// Metro configuration pour monorepo npm workspaces
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Racine du projet mobile
const projectRoot = __dirname;
// Racine du monorepo (deux niveaux au-dessus : apps/mobile -> apps -> root)
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Surveiller tous les fichiers du monorepo
config.watchFolders = [workspaceRoot];

// 2. Résoudre les modules depuis les node_modules du projet ET du root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Forcer la résolution des packages hissés
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
