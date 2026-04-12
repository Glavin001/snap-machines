# snap-machines-viewer

Native Bevy viewer for `snap-machines` play-mode envelopes.

## Run

```bash
cargo run -p snap-machines-viewer
```

That loads the bundled sample fixture by default. To open a JSON envelope exported from the web builder:

```bash
cargo run -p snap-machines-viewer -- path/to/machine.envelope.json
```

## Controls

The viewer reads exported keyboard defaults from the envelope `controls` section when present. Older envelopes without that section fall back to built-in action-name defaults.

- Right mouse drag: orbit camera
- Scroll: zoom
- `Q` / `E`: drive `hingeSpin` and `motorSpin`
- `Space`: drive `throttle`
- `R`: reset the machine to the original envelope state
- `P`: pause or resume simulation
- `F1`: toggle collider/joint debug overlay
