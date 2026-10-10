import type { ComponentType, SVGProps } from "react";
import {
  AppWindowMac,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  CircleHelp,
  CircleStop,
  CircleUserRound,
  CircleX,
  Folder,
  Hammer,
  HardDrive,
  History,
  Info,
  MessagesSquare,
  Moon,
  Package,
  Plus,
  RefreshCw,
  RotateCw,
  Scissors,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Store,
  TriangleAlert,
  Zap,
} from "lucide-react";

/**
 * SF Symbol names used by the iOS views mapped to the closest Lucide glyphs.
 * `.fill` variants render with a filled body so weight matches the badges.
 */
export type SymbolName =
  | "gearshape"
  | "sparkles"
  | "externaldrive.badge.exclamationmark"
  | "exclamationmark.triangle"
  | "exclamationmark.triangle.fill"
  | "bolt.fill"
  | "checkmark.circle"
  | "checkmark.circle.fill"
  | "moon.fill"
  | "questionmark.circle"
  | "questionmark.circle.fill"
  | "exclamationmark.circle"
  | "arrow.trianglehead.2.clockwise"
  | "info.circle"
  | "person.crop.circle.badge.questionmark"
  | "stop.circle.fill"
  | "shippingbox"
  | "chevron.right"
  | "chevron.down"
  | "chevron.left"
  | "chevron.up.chevron.down"
  | "iphone"
  | "hammer"
  | "paperplane.fill"
  | "storefront"
  | "terminal"
  | "arrow.clockwise"
  | "plus"
  | "arrow.triangle.2.circlepath"
  | "clock.arrow.circlepath"
  | "scissors"
  | "arrow.up.circle.fill"
  | "bubble.left.and.bubble.right"
  | "checkmark.shield"
  | "macwindow"
  | "folder"
  | "xmark.circle.fill";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number }>;

const GLYPHS: Record<SymbolName, { icon: LucideIcon; filled?: boolean }> = {
  gearshape: { icon: Settings },
  sparkles: { icon: Sparkles, filled: true },
  "externaldrive.badge.exclamationmark": { icon: HardDrive },
  "exclamationmark.triangle": { icon: TriangleAlert },
  "exclamationmark.triangle.fill": { icon: TriangleAlert, filled: true },
  "bolt.fill": { icon: Zap, filled: true },
  "checkmark.circle": { icon: CircleCheck },
  "checkmark.circle.fill": { icon: CircleCheck, filled: true },
  "moon.fill": { icon: Moon, filled: true },
  "questionmark.circle": { icon: CircleHelp },
  "questionmark.circle.fill": { icon: CircleHelp, filled: true },
  "exclamationmark.circle": { icon: CircleAlert },
  "arrow.trianglehead.2.clockwise": { icon: RefreshCw },
  "info.circle": { icon: Info },
  "person.crop.circle.badge.questionmark": { icon: CircleUserRound },
  "stop.circle.fill": { icon: CircleStop, filled: true },
  shippingbox: { icon: Package },
  "chevron.right": { icon: ChevronRight },
  "chevron.down": { icon: ChevronDown },
  "chevron.left": { icon: ChevronLeft },
  "chevron.up.chevron.down": { icon: ChevronsUpDown },
  iphone: { icon: Smartphone },
  hammer: { icon: Hammer },
  "paperplane.fill": { icon: Send, filled: true },
  storefront: { icon: Store },
  terminal: { icon: SquareTerminal },
  "arrow.clockwise": { icon: RotateCw },
  plus: { icon: Plus },
  "arrow.triangle.2.circlepath": { icon: RefreshCw },
  "clock.arrow.circlepath": { icon: History },
  scissors: { icon: Scissors },
  "arrow.up.circle.fill": { icon: CircleArrowUp, filled: true },
  "bubble.left.and.bubble.right": { icon: MessagesSquare },
  "checkmark.shield": { icon: ShieldCheck },
  macwindow: { icon: AppWindowMac },
  folder: { icon: Folder },
  "xmark.circle.fill": { icon: CircleX, filled: true },
};

export interface SymbolProps {
  name: SymbolName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Filled glyphs draw their strokes in the page background to read like SF `.fill` symbols. */
  fillStroke?: string;
  title?: string;
}

export function Symbol({ name, size = 17, strokeWidth = 2, className, fillStroke, title }: SymbolProps) {
  const glyph = GLYPHS[name];
  const Icon = glyph.icon;
  const filled = glyph.filled === true;
  return (
    <Icon
      size={size}
      strokeWidth={filled ? 2 : strokeWidth}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? (fillStroke ?? "currentColor") : "currentColor"}
      style={filled && fillStroke ? { stroke: fillStroke } : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
    </Icon>
  );
}
