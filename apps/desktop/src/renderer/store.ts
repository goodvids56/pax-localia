import type {
  AppSettings,
  GameSummary,
  GameView,
  Scenario,
  ScenarioSummary,
  TimelineProgress,
} from '@pax-localia/domain';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Screen =
  | 'setup'
  | 'home'
  | 'library'
  | 'new-game'
  | 'game'
  | 'settings'
  | 'editor'
  | 'diagnostics'
  | 'licenses';

interface AppState {
  screen: Screen;
  previousScreen: Screen;
  settings: AppSettings | undefined;
  scenarios: ScenarioSummary[];
  games: GameSummary[];
  selectedScenario: Scenario | undefined;
  game: GameView | undefined;
  selectedRegionId: string | undefined;
  selectedActorId: string | undefined;
  bottomTab: 'actions' | 'diplomacy' | 'advisor';
  leftTab: 'events' | 'actors' | 'objectives' | 'history' | 'layers';
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  loading: string;
  error: string;
  notice: string;
  progress: TimelineProgress | undefined;
  setScreen: (screen: Screen) => void;
  setSettings: (settings: AppSettings) => void;
  setScenarios: (scenarios: ScenarioSummary[]) => void;
  setGames: (games: GameSummary[]) => void;
  setSelectedScenario: (scenario?: Scenario) => void;
  setGame: (game?: GameView) => void;
  selectRegion: (id?: string) => void;
  selectActor: (id?: string) => void;
  setBottomTab: (tab: AppState['bottomTab']) => void;
  setLeftTab: (tab: AppState['leftTab']) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLoading: (loading: string) => void;
  setError: (error: string) => void;
  setNotice: (notice: string) => void;
  setProgress: (progress?: TimelineProgress) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      screen: 'home',
      previousScreen: 'home',
      settings: undefined,
      scenarios: [],
      games: [],
      selectedScenario: undefined,
      game: undefined,
      selectedRegionId: undefined,
      selectedActorId: undefined,
      bottomTab: 'actions',
      leftTab: 'events',
      leftCollapsed: false,
      rightCollapsed: false,
      loading: '',
      error: '',
      notice: '',
      progress: undefined,
      setScreen: (screen) =>
        set((state) => ({ screen, previousScreen: state.screen, error: '', notice: '' })),
      setSettings: (settings) => set({ settings }),
      setScenarios: (scenarios) => set({ scenarios }),
      setGames: (games) => set({ games }),
      setSelectedScenario: (selectedScenario) => set({ selectedScenario }),
      setGame: (game) => set({ game }),
      selectRegion: (selectedRegionId) => set({ selectedRegionId, rightCollapsed: false }),
      selectActor: (selectedActorId) => set({ selectedActorId, rightCollapsed: false }),
      setBottomTab: (bottomTab) => set({ bottomTab }),
      setLeftTab: (leftTab) => set({ leftTab, leftCollapsed: false }),
      toggleLeft: () => set((state) => ({ leftCollapsed: !state.leftCollapsed })),
      toggleRight: () => set((state) => ({ rightCollapsed: !state.rightCollapsed })),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error, loading: '' }),
      setNotice: (notice) => set({ notice }),
      setProgress: (progress) => set({ progress }),
    }),
    {
      name: 'pax-localia-layout',
      partialize: (state) => ({
        bottomTab: state.bottomTab,
        leftTab: state.leftTab,
        leftCollapsed: state.leftCollapsed,
        rightCollapsed: state.rightCollapsed,
      }),
    },
  ),
);
