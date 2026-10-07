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
import { CarsScreen } from './screens/cars/CarsScreen';
import { PassportModal } from './screens/quality/PassportModal';
import { connectLive, useLive } from './state/live';
import { closePassport, useView } from './state/view';
import { startCarTracking } from './state/watch';
import { WatchToast } from './components/Watch';
import { useTranslation } from './i18n/store';
import { AccessGate } from './components/AccessGate';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Shell() {
  const { t } = useTranslation();
  const snapshot = useLive((s) => s.snapshot);
  const booting = useLive((s) => s.booting);
  const live = snapshot && snapshot.ready ? snapshot : null;
  const passport = useView((v) => v.passport);
  return (
    <div className="min-h-screen">
      <AppHeader now={live?.now ?? null} shiftIndex={live?.shift?.index ?? null} speed={live?.speed ?? 1} />
      <Routes>
        <Route index element={live ? <ShopNowScreen snapshot={live} /> : <Booting message={booting} />} />
        <Route path="cars" element={<CarsScreen />} />
        <Route path="plan" element={<PlanScreen />} />
        <Route path="quality" element={<QualityScreen />} />
        <Route path="equipment" element={<EquipmentScreen />} />
        <Route path="sources" element={<SourcesScreen />} />
        <Route path="settings" element={<SettingsScreen />} />
        <Route path="*" element={<Placeholder title={t.common.pageNotFound} stage="—" />} />
      </Routes>
      <DemoPanel />
      {/* паспорт автомобиля открывается из карточки машины на любом экране */}
      <PassportModal vin={passport} onClose={closePassport} />
      <WatchToast />
    </div>
  );
}

/** Приложение после входа: только тогда подключаемся к данным двойника */
function Authed() {
  useEffect(() => {
    startCarTracking();
    connectLive();
  }, []);
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

export function App() {
  return (
    <AccessGate>
      <Authed />
    </AccessGate>
  );
}
