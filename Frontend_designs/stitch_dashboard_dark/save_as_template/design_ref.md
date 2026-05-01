# Save as Template — Design Reference

**Stitch Project:** `3352624901381210886` (Dashboard Dark)
**Stitch Screen ID:** `32105f59b5634096a991d5d8f3e25a7a`

## Integration point
- Triggered from the D365 Activity Logger Dialog (DashboardPage)
- Button: "Save as Template" — ghost style, below the form fields, before Submit

## Modal specs (from Stitch generation)
- Width: 480px, centered, sharp corners (no border-radius)
- Overlay: rgba(0,0,0,0.6) + backdrop-blur
- Card: bg #141416, border #1f2022

### Header
- Orange Bookmark icon (lucide-react) + "Save as Template" (Space Grotesk, white, 20px bold)
- Subtext: "Save these settings as a reusable preset for future activities." (#9CA3AF, 14px)
- Divider: 1px #1f2022

### Body
1. **Template Name** input — bg #0f0f10, border #1f2022, placeholder "e.g. Weekly check-in call"
2. **Saved values preview** — read-only pills showing current form values:
   - Activity Type, Account, Duration, Notes (first 60 chars)
   - Pill style: bg #1f2022, text #9CA3AF, text-xs

### Footer
- Left: **Cancel** — ghost button, border #1f2022, gray text
- Right: **Save Template** — bg #FF4500, white text

## Backend integration (Phase 4)
- POST /api/workflows/templates — body: { name, workflow_id, params }
- GET /api/workflows/templates — list saved templates
- Templates listed as quick-fill presets in the D365 Logger dialog header
