// Наряды, отправленные из этого браузера: время берём из ответа шлюза на «Принять».
// Варианты вида «сейчас» двойник пересчитывает каждые 20 секунд (через 10 минут от текущего момента),
// а наряд уже ушёл на конкретное время — его и показываем на плашке в 3D.
import { create } from 'zustand';

export const useIssuedOrders = create<Record<string, string>>(() => ({}));

export function rememberOrder(incidentId: string, scheduledAt: string) {
  useIssuedOrders.setState({ [incidentId]: scheduledAt });
}
