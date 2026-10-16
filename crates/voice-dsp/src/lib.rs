//! Dependency-free DSP kernel. Handwired handles learning; Rust handles sound analysis.
use std::f64::consts::PI;
fn normalize(values: &mut [f32]) {
    let maximum = values.iter().copied().fold(0.00001_f32, f32::max);
    for v in values {
        *v = *v / maximum * 0.85;
    }
}
pub fn vowel(kind: u32, pitch: f32) -> [f32; 16] {
    let formants: [(f32, f32); 3] = match kind {
        1 => [(750., 250.), (1200., 280.), (2600., 450.)],
        2 => [(300., 140.), (2300., 350.), (3000., 450.)],
        _ => [(350., 150.), (800., 230.), (2200., 400.)],
    };
    let mut amplitudes = [0.; 16];
    for (h, a) in amplitudes.iter_mut().enumerate() {
        let f = (h + 1) as f32 * pitch;
        let peaks: f32 = formants
            .iter()
            .map(|(center, width)| (-0.5 * ((f - center) / width).powi(2)).exp())
            .sum();
        *a = (0.12 + peaks) / ((h + 1) as f32).powf(0.45);
    }
    normalize(&mut amplitudes);
    amplitudes
}
pub fn cycle(amplitudes: &[f32], samples: usize) -> Vec<f32> {
    (0..samples)
        .map(|s| {
            amplitudes
                .iter()
                .enumerate()
                .map(|(h, a)| {
                    *a as f64 * (2. * PI * (h + 1) as f64 * s as f64 / samples as f64).sin()
                })
                .sum::<f64>() as f32
        })
        .collect()
}
pub fn detect_pitch(samples: &[f32], sample_rate: f32) -> Option<(f32, f32)> {
    let stride = (sample_rate / 12000.).floor().max(1.) as usize;
    let rate = sample_rate / stride as f32;
    let x: Vec<f64> = samples
        .iter()
        .step_by(stride)
        .take(3072)
        .map(|x| *x as f64)
        .collect();
    if x.len() < 64 {
        return None;
    }
    let max_lag = ((rate / 65.) as usize).min(x.len() / 2 - 1);
    let min_lag = (rate / 600.) as usize;
    let size = x.len() - max_lag;
    let mut yin = vec![1.; max_lag + 1];
    let mut running = 0.;
    for lag in 1..=max_lag {
        let d: f64 = (0..size).map(|i| (x[i] - x[i + lag]).powi(2)).sum();
        running += d;
        yin[lag] = if running > 0. {
            d * lag as f64 / running
        } else {
            1.
        };
    }
    for mut lag in min_lag..max_lag.saturating_sub(1) {
        if yin[lag] < 0.15 {
            while lag < max_lag && yin[lag + 1] < yin[lag] {
                lag += 1;
            }
            let (a, b, c) = (
                yin[lag - 1],
                yin[lag],
                *yin.get(lag + 1).unwrap_or(&yin[lag]),
            );
            let denominator = a - 2. * b + c;
            let offset = if denominator != 0. {
                (0.5 * (a - c) / denominator).clamp(-0.5, 0.5)
            } else {
                0.
            };
            return Some((rate / (lag as f32 + offset as f32), (1. - b) as f32));
        }
    }
    None
}
#[derive(Debug)]
pub enum AnalysisError {
    Quiet,
    Unstable,
    Invalid,
}
pub struct Analysis {
    pub pitch: f32,
    pub confidence: f32,
    pub amplitudes: [f32; 16],
}
pub fn analyze(samples: &[f32], sample_rate: f32) -> Result<Analysis, AnalysisError> {
    if samples.len() < 1024
        || samples.len() > 768000
        || !(8000. ..=192000.).contains(&sample_rate)
        || samples.iter().any(|v| !v.is_finite())
    {
        return Err(AnalysisError::Invalid);
    }
    let energy: f64 = samples.iter().map(|x| (*x as f64).powi(2)).sum();
    if (energy / samples.len() as f64).sqrt() < 0.008 {
        return Err(AnalysisError::Quiet);
    }
    let length = 8192.min(samples.len());
    let mut frames = Vec::new();
    for start in ((samples.len() as f32 * 0.2) as usize..=samples.len() - length)
        .step_by((sample_rate * 0.12) as usize)
    {
        if let Some((pitch, confidence)) =
            detect_pitch(&samples[start..start + length], sample_rate)
        {
            if confidence > 0.85 {
                frames.push((pitch, confidence, start));
            }
        }
    }
    frames.sort_by(|a, b| a.0.total_cmp(&b.0));
    let &(pitch, confidence, start) = frames
        .get(frames.len() / 2)
        .ok_or(AnalysisError::Unstable)?;
    let frame = &samples[start..start + length];
    let mut amplitudes = [0.; 16];
    for (h, a) in amplitudes.iter_mut().enumerate() {
        let frequency = pitch as f64 * (h + 1) as f64;
        if frequency >= sample_rate as f64 / 2. {
            continue;
        }
        let (mut real, mut imaginary) = (0., 0.);
        for (i, sample) in frame.iter().enumerate() {
            let windowed = *sample as f64
                * (0.5 - 0.5 * (2. * PI * i as f64 / (frame.len() - 1) as f64).cos());
            let angle = 2. * PI * frequency * i as f64 / sample_rate as f64;
            real += windowed * angle.cos();
            imaginary += windowed * angle.sin();
        }
        *a = real.hypot(imaginary) as f32;
    }
    normalize(&mut amplitudes);
    Ok(Analysis {
        pitch,
        confidence,
        amplitudes,
    })
}
// Raw WASM ABI. JS owns the lifetime of all buffers; no wasm-bindgen dependency.
#[no_mangle]
pub extern "C" fn alloc_floats(len: usize) -> *mut f32 {
    Box::into_raw(vec![0.0_f32; len].into_boxed_slice()) as *mut f32
}
/// # Safety
/// ptr must be a live alloc_floats allocation of exactly len floats.
#[no_mangle]
pub unsafe extern "C" fn free_floats(ptr: *mut f32, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
/// # Safety
/// output must point to 16 writable floats.
#[no_mangle]
pub unsafe extern "C" fn sample_vowel(kind: u32, pitch: f32, output: *mut f32) {
    std::slice::from_raw_parts_mut(output, 16).copy_from_slice(&vowel(kind, pitch));
}
/// # Safety
/// amplitudes must point to 16 readable floats; output to 128 writable floats.
#[no_mangle]
pub unsafe extern "C" fn render_cycle(amplitudes: *const f32, output: *mut f32) {
    let rendered = cycle(std::slice::from_raw_parts(amplitudes, 16), 128);
    std::slice::from_raw_parts_mut(output, 128).copy_from_slice(&rendered);
}
/// # Safety
/// input must point to len readable floats; output to 18 writable floats.
#[no_mangle]
pub unsafe extern "C" fn analyze_voice(
    input: *const f32,
    len: usize,
    sample_rate: f32,
    output: *mut f32,
) -> u32 {
    match analyze(std::slice::from_raw_parts(input, len), sample_rate) {
        Ok(result) => {
            let out = std::slice::from_raw_parts_mut(output, 18);
            out[0] = result.pitch;
            out[1] = result.confidence;
            out[2..].copy_from_slice(&result.amplitudes);
            0
        }
        Err(AnalysisError::Quiet) => 1,
        Err(AnalysisError::Unstable) => 2,
        Err(AnalysisError::Invalid) => 3,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovers_synthetic_vowel() {
        for rate in [44100., 48000.] {
            for pitch in [110., 196., 330.] {
                let target = vowel(1, pitch);
                let samples: Vec<f32> = (0..(rate as usize * 2))
                    .map(|i| {
                        target
                            .iter()
                            .enumerate()
                            .map(|(h, a)| {
                                0.12 * *a as f64
                                    * (2. * PI * (h + 1) as f64 * pitch as f64 * i as f64
                                        / rate as f64
                                        + h as f64 * 0.23)
                                        .sin()
                            })
                            .sum::<f64>() as f32
                    })
                    .collect();
                let result = analyze(&samples, rate).unwrap();
                assert!(
                    (result.pitch - pitch).abs() < 1.,
                    "{} vs {}",
                    result.pitch,
                    pitch
                );
                assert!(result
                    .amplitudes
                    .iter()
                    .zip(target)
                    .all(|(a, b)| (*a - b).abs() < 0.04));
            }
        }
    }
    #[test]
    fn rejects_bad_audio() {
        assert!(matches!(
            analyze(&vec![0.; 96000], 48000.),
            Err(AnalysisError::Quiet)
        ));
        assert!(matches!(
            analyze(&[f32::NAN; 1024], 48000.),
            Err(AnalysisError::Invalid)
        ));
    }
    #[test]
    fn sine_cycle_has_expected_quarters() {
        let mut weights = [0.; 16];
        weights[0] = 1.;
        let result = cycle(&weights, 128);
        assert!((result[32] - 1.).abs() < 1e-6);
        assert!((result[96] + 1.).abs() < 1e-6);
    }
}
