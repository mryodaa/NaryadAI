import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppHeader } from './components/AppHeader';
import { Booting } from './components/Booting';
import { DemoPanel } from './components/DemoPanel';
import { ShopNowScreen } from './screens/shop/ShopNowScreen';
import { Placeholder } from './screens/Placeholder';
import { PlanScreen } from './screens/plan/PlanScreen';
import { SourcesScreen } from './screens/sources/SourcesScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { MasterScreen } from './screens/master/MasterScreen';
import { QualityScreen } from './screens/quality/QualityScreen';
import { EquipmentScreen } from './screens/equipment/EquipmentScreen';
import { connectLive, useLive } from './state/live';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Shell() {
  const snapshot = useLive((s) => s.snapshot);
  const booting = useLive((s) => s.booting);
  const live = snapshot && snapshot.ready ? snapshot : null;
  return (
    <div className="min-h-screen">
      <AppHeader now={live?.now ?? null} shiftIndex={live?.shift?.index ?? null} speed={live?.speed ?? 1} />
      <Routes>
        <Route index element={live ? <ShopNowScreen snapshot={live} /> : <Booting message={booting} />} />
        <Route path="plan" element={<PlanScreen />} />
        <Route path="quality" element={<QualityScreen />} />
        <Route path="equipment" element={<EquipmentScreen />} />
        <Route path="sources" element={<SourcesScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Placeholder title="Страница не найдена" stage="—" />} />
      </Routes>
      <DemoPanel />
    </div>
  );
}

export function App() {
  useEffect(() => connectLive(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/master" element={<MasterScreen />} />
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
