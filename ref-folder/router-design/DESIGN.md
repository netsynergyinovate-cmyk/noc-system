---
name: Obsidian Telemetry NOC
colors:
  surface: '#0f131b'
  surface-dim: '#0f131b'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#bdc2ff'
  on-secondary: '#131e8c'
  secondary-container: '#2f3aa3'
  on-secondary-container: '#a8afff'
  tertiary: '#ffc176'
  on-tertiary: '#472a00'
  tertiary-container: '#f1a02b'
  on-tertiary-container: '#613b00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#e0e0ff'
  secondary-fixed-dim: '#bdc2ff'
  on-secondary-fixed: '#000767'
  on-secondary-fixed-variant: '#2f3aa3'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb960'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0f131b'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: -0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.02em
  label-xs:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: '400'
    lineHeight: 0.75rem
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1rem
  margin: 0.75rem
  margin-desktop: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system is engineered for mission-critical, high-density Network Operations Center (NOC) environments and enterprise infrastructure control planes. The design aesthetic balances severe minimalism with absolute functional legibility.

### Core Philosophy
- **Instrument-First Precision:** Every pixel, border, and character serves data hierarchy. Gratuitous styling, decorative illustrations, heavy drop-shadows, and bright saturated backgrounds are prohibited.
- **Visual Silence:** The interface maintains an ultra-dark, low-luminance baseline to minimize eye strain across prolonged 12-hour operator shifts.
- **Surgical Chromatic Discipline:** Color is treated strictly as an alert vector, status light, or telemetry indicator. Text and structural containers remain strictly achromatic and neutral.
- **Data Density:** Layouts maximize screen real estate using tight spacing, compact component footprints, and monospaced tabular alignment.

## Colors

The palette operates under an uncompromising dark architecture. It establishes clear separation between canvas surfaces, analytical metric visualizers, and state signaling.

### Canvas & Surface Hierarchy
- **Canvas Base (`#0a0d14`):** Global page canvas and deep inset wells.
- **Canvas Raised (`#0e121a`):** Primary workspace surface and main structural backdrop.
- **Surface Level 1 (`#131722`):** Cards, data tables, panel containers, and drawer backgrounds.
- **Surface Level 2 (`#181d29`):** Hover states, nested rows, active tabs, and input control surfaces.

### Border & Division Tokens
- **Border Default (`#1f2533`):** 1px dividers, gridlines, table cell separations, and panel outlines.
- **Border Strong (`#283042`):** Interactive element boundaries, focus states, and split-pane dividers.

### Typography Neutral Scale
- **Text Primary (`#f3f4f6`):** Extreme legibility for primary telemetry values, critical table readouts, and headers.
- **Text Secondary (`#9ca3af`):** Standard metadata, inactive labels, and secondary context.
- **Text Tertiary (`#6b7280`):** Timestamps, unit denominators (e.g., `ms`, `Gbps`), and structural keys.

### Telemetry & Functional Accents
Functional accents must never be used for large surface backgrounds or multi-line text blocks.
- **Status Online / Healthy (`#10b981`):** Applied strictly to 6px/8px status dots, badge badges, and uptime pings.
- **Status Warning / Degraded (`#f59e0b`):** Latency spikes, warning flags, and threshold triggers.
- **Status Critical / Outage (`#f43f5e`):** Link down states, dropped packets, and critical hardware alerts.
- **Metrics Primary (`#38bdf8`):** Network throughput lines, ingress data streams, and active packet filters.
- **Metrics Secondary (`#818cf8`):** Egress telemetry, memory consumption, and secondary analytical plots.

## Typography

The type system uses a dual-engine font pairing engineered for scan-speed and raw data ingestion.

- **System & UI Font (Inter):** Applied across all structural titles, modal headers, navigation nodes, and descriptive text. Configured with a tight vertical rhythm and slight negative tracking on larger headers to maintain maximum density.
- **Telemetry & Metric Font (JetBrains Mono):** Applied to numeric readings, IP addresses, CIDR blocks, SHA hashes, timestamps, throughput stats, and tabular data rows.
- **Tabular Figures (`tnum`):** Monospace figures are universally forced across all numeric and time outputs to guarantee vertical alignment in dense tables without column drift.
- **Scale Ceiling:** Structural headers intentionally cap at 20px (`1.25rem`). NOC screens prioritize dashboard matrix real estate over expressive typographic hierarchies.

## Layout & Spacing

The layout operates on a fluid, multi-pane docking architecture optimized for multi-monitor workstation setups (1080p, 1440p, 4K arrays).

### Layout Geometry
- **Grid Structure:** Modular 24-column or flex-dock fluid layout that occupies 100% of the viewport viewport height (`100vh`) with zero exterior window overflow. Panels use internal scrolling.
- **Gutter & Margins:** Outer margin baseline is `1rem` (16px) on full desktop workstations, tightening to `0.75rem` (12px) on secondary displays. Column gaps remain fixed at `0.75rem` to preserve space.
- **Micro-Scale Spacing:** Padding follows an ultra-compact 4px/6px/8px rhythm. Standard input fields, table rows, and status badges utilize `space-xs` (4px) and `space-sm` (6px) vertical paddings to pack vital network nodes into visible viewport folds.

## Elevation & Depth

This design system avoids all diffuse, blur-heavy drop shadows. Spatial hierarchy is communicated exclusively through surface luminance tiers and fine 1px structural borders.

### Elevation Tiers
- **Tier 0 (Deep Canvas / Sinks):** `#0a0d14` — Code consoles, log viewports, graph canvas backgrounds.
- **Tier 1 (Base Viewports):** `#0e121a` — Background behind docked panels.
- **Tier 2 (Panels & Cards):** `#131722` — Enclosed with a `1px solid #1f2533` stroke.
- **Tier 3 (Popovers, Tooltips & Context Menus):** `#181d29` — Bordered with `1px solid #283042` and paired with a crisp, non-diffuse edge boundary (`0 4px 12px rgba(0, 0, 0, 0.7)`).

## Shapes

The design system employs a restrained, soft-cornered industrial profile (`roundedness: 1`).

- **Base Radius (2px to 4px):** Applied to cards, table cells, metric tiles, buttons, inputs, and dropdown selectors. Rounding is kept minimal to maximize pixel grid alignment and reinforce a technical, instrumentation console feel.
- **Pill Exceptions:** Restricted solely to round status indicators (e.g., live/down pulse circles) and select compact count tags. Circular shapes are never used for action buttons or layout panels.

## Components

### Buttons
- **Primary:** Background `#181d29`, 1px solid `#283042`, text `#f3f4f6`. On hover: border `#38bdf8`, background `#1f2533`.
- **Destructive:** Background `#181d29`, 1px solid `#f43f5e`, text `#f43f5e`.
- **Dimensions:** Height 28px, padding 0 8px, font JetBrains Mono 11px (`label-sm`), uppercase with 0.05em letter spacing.

### Status Indicators & Chips
- **Status Dots:** 6px × 6px circles with zero text styling changes. Status Online glows subtly via `box-shadow: 0 0 6px #10b98188`.
- **Badges:** Outlined only (1px solid `#1f2533`), height 20px, font 10px JetBrains Mono (`label-xs`), neutral gray text (`#9ca3af`) with an embedded colored status dot.

### Data Tables
- **Row Density:** Fixed 28px to 32px height.
- **Separators:** 1px horizontal border `#1f2533` between rows; no vertical borders.
- **Row Hover:** Highlight row background `#181d29`.
- **Typography:** JetBrains Mono 11px (`label-sm`), primary text `#f3f4f6` for IPs and throughput, tertiary text `#6b7280` for timestamps and protocols.

### Input Fields & Selectors
- **Height:** 28px compact sizing.
- **Surface:** Background `#0e121a`, border 1px solid `#1f2533`, text `#f3f4f6`.
- **Focus:** 1px solid `#38bdf8` without outer glow rings. Placeholder text `#6b7280`.

### Cards & Panels
- **Container Structure:** Surface `#131722`, border 1px solid `#1f2533`.
- **Header:** 32px header bar separated with a 1px solid `#1f2533` bottom rule, uppercase 11px Inter (`label-sm`) title in `#9ca3af`.

### Telemetry Sparklines & Time-Series Graphs
- **Canvas:** Flat `#0a0d14` background.
- **Grid Lines:** `#1f2533` stroke at 0.5px.
- **Data Series:** 1.5px continuous stroke in `#38bdf8` (ingress) or `#818cf8` (egress), zero drop-shadow, no gradient fill underneath unless fading to full transparent at 5% opacity.