import path from 'node:path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const rootDirectory = path.resolve(__dirname, '../..');

export default {
  packagerConfig: {
    name: 'Pax Localia',
    executableName: 'pax-localia',
    appBundleId: 'org.paxlocalia.desktop',
    appCategoryType: 'public.app-category.games',
    asar: {
      unpack: '**/*.node',
    },
    extraResource: [path.join(rootDirectory, 'assets')],
    ignore: [
      /^\/tests($|\/)/,
      /^\/docs($|\/)/,
      /^\/coverage($|\/)/,
      /^\/playwright-report($|\/)/,
      /^\/\.github($|\/)/,
    ],
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({
      name: 'PaxLocalia',
      setupExe: 'Pax-Localia-Setup.exe',
      noMsi: true,
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDMG({ format: 'ULFO' }),
    new MakerDeb({
      options: {
        maintainer: 'Pax Localia contributors',
        homepage: 'https://github.com/goodvids56/pax-localia',
        categories: ['Game'],
      },
    }),
    new MakerRpm({
      options: {
        homepage: 'https://github.com/goodvids56/pax-localia',
        categories: ['Game'],
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
