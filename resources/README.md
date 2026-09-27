# App icons

Drop your icon files here. Anything missing falls back to a built-in placeholder.

| File | Size | Used for |
| --- | --- | --- |
| `icon.ico` | multi-size: 16, 24, 32, 48, 64, 128, 256 px | The `.exe`, the installer and the Start menu (picked up by electron-builder automatically) |
| `icon.png` | 512 × 512 px | The window and taskbar icon while the app runs |
| `tray.png` | 32 × 32 px (add `tray@2x.png` at 64 × 64 for high-DPI screens) | The system tray icon |

Tips:

- Keep the tray icon simple and readable at 16 px; it sits next to the clock.
- Use a transparent background for `tray.png`.
- To make `icon.ico` from a PNG, any converter that exports several sizes into one `.ico` works (for example ImageMagick: `magick icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico`).
