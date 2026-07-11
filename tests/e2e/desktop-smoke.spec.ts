import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const temporaryDirectories: string[] = [];

function developmentElectronExecutable(): string {
  const pnpmStore = path.join(process.cwd(), 'node_modules', '.pnpm');
  const pnpmDistributions = existsSync(pnpmStore)
    ? readdirSync(pnpmStore)
        .filter((entry) => entry.startsWith('electron@'))
        .map((entry) => path.join(pnpmStore, entry, 'node_modules', 'electron', 'dist'))
    : [];
  const distributions = [
    path.join(process.cwd(), 'node_modules', 'electron', 'dist'),
    path.join(process.cwd(), 'apps', 'desktop', 'node_modules', 'electron', 'dist'),
    ...pnpmDistributions,
  ];
  for (const distribution of distributions) {
    const executable =
      process.platform === 'win32'
        ? path.join(distribution, 'electron.exe')
        : process.platform === 'darwin'
          ? path.join(distribution, 'Electron.app', 'Contents', 'MacOS', 'Electron')
          : path.join(distribution, 'electron');
    if (existsSync(executable)) return executable;
  }
  throw new Error('The development Electron executable was not installed.');
}

async function launch(dataDirectory: string): Promise<ElectronApplication> {
  mkdirSync(dataDirectory, { recursive: true });
  return electron.launch({
    executablePath: developmentElectronExecutable(),
    args: [process.cwd(), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      PAX_LOCALIA_E2E_DATA_DIR: dataDirectory,
    },
  });
}

test.afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

test('first run, deterministic turn, restart, and branch smoke flow', async () => {
  const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'pax-localia-e2e-'));
  temporaryDirectories.push(dataDirectory);
  let application = await launch(dataDirectory);
  let page = await application.firstWindow();

  await expect(
    page.getByRole('heading', { name: 'Forge a history that stays on your computer.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Deterministic mode/ }).click();
  await page.getByRole('button', { name: 'Enter Pax Localia' }).click();
  await expect(page.getByRole('heading', { name: 'Pax Localia' })).toBeVisible();

  await page.getByRole('button', { name: 'Create a new timeline' }).click();
  const crisisCard = page.locator('.scenario-card').filter({ hasText: 'The Selene Border Crisis' });
  await crisisCard.getByRole('button', { name: 'Start timeline' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your actor' })).toBeVisible();
  await page.getByRole('button', { name: 'Create local timeline' }).click();
  await expect(page.getByText('PAUSED')).toBeVisible();

  await expect(page.locator('.map-label').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.map-label').filter({ hasText: 'Selene Crossing' }).click();
  const composer = page.getByPlaceholder(/What should Aster do/);
  await composer.fill('Advance carefully into the disputed crossing while protecting civilians');
  await page.getByRole('button', { name: 'Add action' }).click();
  await expect(page.locator('.action-queue')).toContainText('Advance carefully');
  await page.getByRole('button', { name: 'Advance time' }).click();
  await expect(page.getByText('Timeline advanced and snapshot saved.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.event-feed')).toContainText(/Initiative|Mixed result/, {
    timeout: 10_000,
  });

  await application.close();
  application = await launch(dataDirectory);
  page = await application.firstWindow();
  await expect(page.getByRole('heading', { name: 'Continue a timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).first().click();
  await expect(page.getByText('PAUSED')).toBeVisible();
  await page.getByRole('button', { name: 'History and branches' }).click();
  await page.getByLabel('Snapshot turn').fill('0');
  await page.getByLabel('New branch label').fill('E2E alternative');
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('.branch-list strong').getByText('E2E alternative')).toBeVisible();
  await expect(page.getByText('New branch created.')).toBeVisible();
  await application.close();
});

test('duplicate, edit, validate, and test-launch a scenario', async () => {
  const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'pax-localia-editor-e2e-'));
  temporaryDirectories.push(dataDirectory);
  const application = await launch(dataDirectory);
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Enter Pax Localia' }).click();
  await page.getByRole('button', { name: 'Create a new timeline' }).click();
  const crisisCard = page.locator('.scenario-card').filter({ hasText: 'The Selene Border Crisis' });
  await crisisCard.getByRole('button', { name: 'Duplicate & edit' }).click();
  await expect(
    page.getByRole('heading', { name: /The Selene Border Crisis — Copy/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actors' }).click();
  const color = page.getByLabel('Map color');
  await color.fill('#2f8f83');
  await page.getByRole('button', { name: 'Validation' }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText('Scenario is valid and can be launched.')).toBeVisible();
  await page.getByRole('button', { name: 'Save scenario' }).click();
  await page.getByRole('button', { name: 'Test launch' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your actor' })).toBeVisible();
  await application.close();
});
