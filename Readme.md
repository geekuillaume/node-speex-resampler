# Speex Resampler

This lib exposes the [Speex resampler](https://speex.org/docs/manual/speex-manual/node7.html) to NodeJS. It uses N-API, cmake and node-addon-api.

From speex creator, the design goals of the resampler are:
- Very fast algorithm
- SIMD-friendly algorithm
- Low memory requirement
- Good *perceptual* quality (and not best SNR)

## How to use

```js
const channels = 2; // minimum is 1, no maximum
const inRate = 44100; // frequency in Hz for the input chunk
const outRate = 44000; // frequency in Hz for the target chunk
const quality = 7; // number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
// you need a new resampler for every audio stream you want to resample
// it keeps data from previous calls to improve the resampling
const resampler = new SpeexResampler(
  channels,
  audioTest.inRate,
  audioTest.outRate,
  audioTest.quality // optionnal
);

const pcmData = Buffer.from(/* interleaved PCM data in signed 16bits int */);
const res = await resampler.processChunk(pcmData);
// res is also a buffer with interleaved signed 16 bits PCM data
```

You can look at the `src/test.js` for more information.

Test music by https://www.bensound.com
