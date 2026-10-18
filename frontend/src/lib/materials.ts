export interface MaterialDef {
  id: string;
  label: string;
  color: [number, number, number];
  roughness: number;
  metalness: number;
  transparent?: boolean;
}

const rgb = (r: number, g: number, b: number): [number, number, number] => [
  r / 255,
  g / 255,
  b / 255,
];

export const MATERIALS: MaterialDef[] = [
  { id: "steel", label: "Steel", color: rgb(168, 173, 181), roughness: 0.35, metalness: 0.9 },
  { id: "aluminum", label: "Aluminum", color: rgb(200, 204, 210), roughness: 0.4, metalness: 0.85 },
  { id: "brushed_metal", label: "Brushed metal", color: rgb(176, 181, 188), roughness: 0.25, metalness: 0.9 },
  { id: "copper", label: "Copper", color: rgb(184, 115, 51), roughness: 0.4, metalness: 0.9 },
  { id: "plastic_white", label: "Plastic white", color: rgb(242, 242, 242), roughness: 0.7, metalness: 0.0 },
  { id: "plastic_black", label: "Plastic black", color: rgb(42, 42, 46), roughness: 0.6, metalness: 0.05 },
  { id: "glass", label: "Glass", color: rgb(207, 232, 239), roughness: 0.1, metalness: 0.0, transparent: true },
  { id: "rubber", label: "Rubber", color: rgb(58, 58, 58), roughness: 0.95, metalness: 0.0 },
  { id: "wood_oak", label: "Wood oak", color: rgb(176, 139, 87), roughness: 0.8, metalness: 0.0 },
  { id: "concrete", label: "Concrete", color: rgb(154, 154, 146), roughness: 0.95, metalness: 0.0 },
  { id: "chrome", label: "Chrome", color: rgb(232, 233, 236), roughness: 0.15, metalness: 1.0 },
  { id: "gold", label: "Gold", color: rgb(212, 175, 55), roughness: 0.3, metalness: 1.0 },
];

export function materialColorCss(color: [number, number, number]): string {
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
}
