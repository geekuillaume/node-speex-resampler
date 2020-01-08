#ifndef NODE_SPEEX_RESAMPLER_H
#define NODE_SPEEX_RESAMPLER_H

#include <napi.h>
#include "../deps/speex/speex_resampler.h"

class SpeexResampler : public Napi::ObjectWrap<SpeexResampler> {
  public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, Napi::Value arg);
    SpeexResampler(const Napi::CallbackInfo& info);
    ~SpeexResampler();

  private:

    SpeexResamplerState *resampler;
    int channels;
    int inRate;
    int outRate;

    static Napi::FunctionReference constructor;
    Napi::Value ProcessChunk(const Napi::CallbackInfo& info);
};


class PromiseWorker : public Napi::AsyncWorker {
  public:
    PromiseWorker(Napi::Promise::Deferred const &d, const char* resource_name) : AsyncWorker(get_fake_callback(d.Env()).Value(), resource_name), deferred(d) {}
    PromiseWorker(Napi::Promise::Deferred const &d) : AsyncWorker(get_fake_callback(d.Env()).Value()), deferred(d) {}

    virtual void Resolve(Napi::Promise::Deferred const &deferred) = 0;

    void OnOK() override {
        Resolve(deferred);
    }

    void OnError(Napi::Error const &error) override {
        deferred.Reject(error.Value());
    }

  private:
    static Napi::Value noop(Napi::CallbackInfo const &info) {
        return info.Env().Undefined();
    }

    Napi::Reference<Napi::Function> const &get_fake_callback(Napi::Env const &env) {
        static Napi::Reference<Napi::Function> fake_callback
                = Napi::Reference<Napi::Function>::New(Napi::Function::New(env, noop), 1);
        fake_callback.SuppressDestruct();

        return fake_callback;
    }

    Napi::Promise::Deferred deferred;
};

class ResamplerWorker : public PromiseWorker {
  public:
    ResamplerWorker(Napi::Promise::Deferred const &deferred,
      SpeexResamplerState *resampler,
      Napi::Buffer<int16_t> inBuffer,
      uint32_t inSize,
      uint32_t outSize
    );
    ~ResamplerWorker();

    void Execute();
    void Resolve(Napi::Promise::Deferred const &deferred);

  private:
    SpeexResamplerState *resampler;
    Napi::Buffer<int16_t> inBuffer;
    int16_t *outBuffer;
    uint32_t outSize;
    uint32_t inSize;
};

#endif
