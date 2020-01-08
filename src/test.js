const {readFileSync, writeFileSync} = require('fs');
const {performance} = require('perf_hooks')
const path = require('path');

const SpeexResampler = require('./index');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
}

const audioTests = [
  {inFile: path.resolve(__dirname, `../resources/24000hz_mono_test.pcm`), inRate: 24000, outRate: 48000, channels: 1, quality: 5},
  {inFile: path.resolve(__dirname, `../resources/24000hz_test.pcm`), inRate: 24000, outRate: 24000, channels: 2, quality: 5},
  {inFile: path.resolve(__dirname, `../resources/24000hz_test.pcm`), inRate: 24000, outRate: 48000, channels: 2, quality: 10},
  {inFile: path.resolve(__dirname, `../resources/44100hz_test.pcm`), inRate: 44100, outRate: 48000, channels: 2},
  {inFile: path.resolve(__dirname, `../resources/44100hz_test.pcm`), inRate: 44100, outRate: 48000, channels: 2, quality: 10},
  {inFile: path.resolve(__dirname, `../resources/44100hz_test.pcm`), inRate: 44100, outRate: 48000, channels: 2, quality: 1},
  {inFile: path.resolve(__dirname, `../resources/44100hz_test.pcm`), inRate: 44100, outRate: 24000, channels: 2, quality: 5},
];

const main = async () => {
  for (const audioTest of audioTests) {
    console.log(`Resampling file ${audioTest.inFile} with ${audioTest.channels} channel(s) from ${audioTest.inRate}Hz to ${audioTest.outRate}Hz (quality: ${audioTest.quality || 7})`);
    const resampler = new SpeexResampler(audioTest.channels, audioTest.inRate, audioTest.outRate, audioTest.quality);
    const filename = path.parse(audioTest.inFile).name;
    const pcmData = readFileSync(audioTest.inFile);

    const start = performance.now();
    const res = await resampler.processChunk(pcmData);
    const end = performance.now();
    console.log(`Resampled in ${Math.floor(end - start)}ms`);
    console.log(`Input stream: ${pcmData.length} bytes, ${pcmData.length / audioTest.inRate / 2 / audioTest.channels}s`);
    console.log(`Output stream: ${res.length} bytes, ${res.length / audioTest.outRate / 2 / audioTest.channels}s`);

    const outputSizeTarget = (pcmData.length * audioTest.outRate) / audioTest.inRate;
    assert(Math.abs(outputSizeTarget - res.length) < 2, `File size not matching target, ${res.length} != ${outputSizeTarget}`);
    console.log();

    writeFileSync(path.resolve(__dirname, `../resources/${filename}_${audioTest.outRate}_${audioTest.quality || 7}_output.pcm`), res);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
})
