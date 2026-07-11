import path from 'node:path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const rootDirectory = path.resolve(__dirname, '../..');
const iconPath =
  process.platform === 'win32'
    ? path.join(rootDirectory, 'assets/icons/pax-localia.ico')
    : process.platform === 'darwin'
      ? path.join(rootDirectory, 'assets/icons/pax-localia.icns')
      : path.join(rootDirectory, 'assets/icons/pax-localia.png');
const packagedRoots = [
  '/.vite',
  '/node_modules/better-sqlite3',
  '/node_modules/bindings',
  '/node_modules/file-uri-to-path',
] as const;

export default {
  packagerConfig: {
    name: 'Pax Localia',
    executableName: 'pax-localia',
    appBundleId: 'org.paxlocalia.desktop',
    appCategoryType: 'public.app-category.games',
    appCopyright: 'Copyright © 2026 Pax Localia contributors',
    icon: iconPath,
    asar: {
      unpack: '**/*.node',
    },
    extraResource: [path.join(rootDirectory, 'assets')],
    ignore: (file: string) =>
      Boolean(file) &&
      file !== '/node_modules' &&
      !packagedRoots.some((root) => file === root || file.startsWith(`${root}/`)),
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
          entry: 'apps/desktop/src/main.ts',
          config: 'apps/desktop/vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'apps/desktop/src/preload.ts',
          config: 'apps/desktop/vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'apps/desktop/vite.renderer.config.ts',
        },
      ],
    }),
    new AutoUnpackNativesPlugin({}),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: process.env.PAX_LOCALIA_E2E_PACKAGE === '1',
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
