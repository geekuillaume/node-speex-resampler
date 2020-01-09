const { Transform } = require('stream');
const SpeexResampler = require('bindings')('speex-resampler').SpeexResampler;

class SpeexResamplerTransform extends Transform {
  constructor(channels, inRate, outRate, quality = 7) {
    super();
    this.resampler = new SpeexResampler(channels, inRate, outRate, quality);
  }

  async _transform(chunk, encoding, callback) {
    try {
      const res = await this.resampler.processChunk(chunk);
      callback(null, res);
    } catch (e) {
      callback(e);
    }
  }
}

SpeexResampler.TransformStream = SpeexResamplerTransform;

module.exports = SpeexResampler;
