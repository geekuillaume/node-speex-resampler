#ifndef NODE_SPEEX_RESAMPLER_H
#define NODE_SPEEX_RESAMPLER_H

#include <napi.h>
#include "../deps/speex/speex_resampler.h"

Napi::Value createResampler(const Napi::CallbackInfo& info);
Napi::Value resampleChunk(const Napi::CallbackInfo& info);

class ResamplerWorker : public Napi::AsyncWorker {
  public:
    ResamplerWorker(Napi::Function& callback,
      SpeexResamplerState *resampler,
      int channels,
      Napi::Buffer<int16_t> inBuffer,
      uint32_t outSize
    );
    ~ResamplerWorker();

    void Execute();
    void OnOK();

  private:
    SpeexResamplerState *resampler;
    Napi::Buffer<int16_t> inBuffer;
    int16_t *outBuffer;
    uint32_t outSize;
    int channels;
};

#endif
