import type { PaxLocaliaApi } from '@pax-localia/domain';

declare global {
  interface Window {
    paxLocalia: PaxLocaliaApi;
  }
}

export {};
