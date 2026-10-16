# Voice Tuner

Hum a steady vowel, teach a small synthesizer its harmonic character, then play the learned sound on a keyboard. A browser-local experiment using **Rust / WebAssembly + Handwired**.

## Run locally

Requires Node.js 24+ and a stable Rust toolchain. No npm or Cargo packages to install.

```sh
rustup target add wasm32-unknown-unknown
npm run dev
```

Open http://127.0.0.1:5173. The dev command builds once; after source edits, restart it and reload the browser. Microphone capture requires HTTPS or localhost. Use a current browser with WebAssembly, Web Audio, and AudioWorklet support.

## Try it

1. Pick a synthetic **ooo / aaa / eee** sample, or record a steady vowel for two seconds.
2. Compare **Listen to target** and **Listen to synth**. For recordings, **Original recording** plays the captured audio separately.
3. Press **Teach the synth**. The 16 harmonic sliders converge on the target; listen while they learn.
4. Click a harmonic number to lock it. Drag sliders to change the timbre, then train the remaining controls.
5. Play the keys with touch, a mouse, or `A W S E D F T G Y H U J K`. Focused piano keys also support Enter/Space.
6. **Save instrument** exports the harmonic recipe as JSON (no audio). Import is not implemented yet.

## Where Rust and Handwired fit

- `crates/voice-dsp`: dependency-free Rust DSP compiled to `wasm32-unknown-unknown`. YIN-style pitch detection, Hann-windowed harmonic analysis, sample vowel construction, and reference waveform generation. A small raw WASM ABI handles float buffers; no wasm-bindgen required.
- `src/dsp.js`: memory-safe-at-the-call-site buffer ownership and WASM adapter.
- `src/model.js`: the actual Handwired `Circuit`. Sixteen trainable source cells mix sinusoidal basis functions into a 128-sample waveform. Squared error is computed inside that circuit. `backpropagateReference` supplies gradients for projected gradient descent; locked coefficients are skipped.
- `src/audio.js` / `src/recorder.js`: browser microphone capture and Web Audio playback. Playback uses the learned harmonic coefficients in a band-limited `PeriodicWave`, with a short attack/release and master compressor.
- `src/app.js`: interface, learning animation, locks, keyboard, and export.

Pitch detection is outside the learned circuit. The recording's harmonic magnitudes are reconstructed with aligned phases, so training matches harmonic character rather than the raw voice waveform. Rust's reference waveform is separately checked against Handwired's forward synthesis. CPU-only; no pretrained model, server inference, or audio upload.

## What the fit means

The displayed fit is `100 * (1 - sqrt(waveform MSE / target mean-square energy))`, clamped to 0–100%. Because both waveforms use the same orthogonal sine basis, it measures relative error in harmonic amplitudes. It is not a perceptual rating or voice-cloning score. The scope uses a shared display scale; listening uses normalized periodic waves.

This first experiment models a single steady vowel using 16 harmonics. It does not model breath, consonants, vibrato, changing formants, or speech. It estimates pitches from about 65–600 Hz. Sample vowels are synthetic. There is no claim that gradient descent is necessary for this simple linear fit: the point is to make Handwired's programmed-to-trainable transition visible and audible.

## Tests and static build

```sh
cargo test --manifest-path crates/voice-dsp/Cargo.toml
npm test
npm run build
```

`dist/` contains the static site, WASM binary, and transpiled Handwired runtime. Serve it with any static host over HTTPS. All asset URLs are relative, so subdirectory hosting works. `CARGO` can override the cargo executable. `PORT` can override the development server port.

Tests exercise pitch and harmonic recovery at multiple sample rates, rejection of silence/noise, actual WASM integration, agreement with Handwired's synthesis, convergence, and locked parameters. Automated synthetic audio tests do not replace testing your physical microphone.

A GitHub Actions template is included at `scripts/github-actions-check.yml`. Move it to `.github/workflows/check.yml` to enable CI using a credential with permission to manage workflows.

## Upstream attribution

The unmodified `vendor/handwired/numeric-ui-core.ts` is from [Cheng Lou's Handwired](https://github.com/chenglou/handwired), pinned at commit `4ea7fcb27ebe93acf49b9f29a93e162b975bad46`. Its MIT license is included beside it. Build uses Node's TypeScript stripping to create the browser module. Handwired remains JavaScript; this is a Rust DSP integration, not a Rust port of Handwired.

Audio remains in memory in your browser and is discarded on reload. Instrument exports contain only harmonic values and metadata. The interface currently requests fonts from Google Fonts; no audio is sent there.
