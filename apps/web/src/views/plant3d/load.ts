// Отдельный чанк с three.js: грузится, только когда нужен 3D (или заранее — при наведении на переключатель).
export const loadPlant3D = () => import('./Plant3DView');
