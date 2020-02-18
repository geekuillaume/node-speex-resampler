#include <napi.h>
#include <iostream>
#include "../deps/speex/speex_resampler.h"
#include "resampler.hh"

void finalizeResampler(Napi::Env env, SpeexResamplerState *state) {
  speex_resampler_destroy(state);
}

Napi::Value createResampler(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  int err = 0;
  int quality = 7;

  if (info.Length() != 3 && info.Length() != 4) {
    throw Napi::Error::New(env, "Should get 3 or 4 arguments: channels, inRate, outRate, [quality]");
  }

  if (!info[0].IsNumber() || info[0].As<Napi::Number>().Int32Value() < 1) {
    throw Napi::Error::New(env, "First argument channels should be a number greater or equal to 1");
  }
  int channels = info[0].As<Napi::Number>().Int32Value();

  if (!info[1].IsNumber() || info[1].As<Napi::Number>().Int32Value() < 1) {
    throw Napi::Error::New(env, "Second argument inRate should be a number greater or equal to 1");
  }
  int inRate = info[1].As<Napi::Number>().Int32Value();

  if (!info[2].IsNumber() || info[2].As<Napi::Number>().Int32Value() < 1) {
    throw Napi::Error::New(env, "Third argument outRate should be a number greater or equal to 1");
  }
  int outRate = info[2].As<Napi::Number>().Int32Value();

  if (info.Length() == 4 && !info[4].IsUndefined()) {
    if (!info[3].IsNumber() || info[3].As<Napi::Number>().Int32Value() < 1 || info[3].As<Napi::Number>().Int32Value() > 10) {
      throw Napi::Error::New(env, "Fourth argument quality should be a number between 1 and 10");
    }
    quality = info[3].As<Napi::Number>().Int32Value();
  }

  SpeexResamplerState *resampler = speex_resampler_init(channels, inRate, outRate, quality, &err);
  if (err != 0) {
    throw Napi::Error::New(env, "Error while initializing speex");
  }

  return Napi::External<SpeexResamplerState>::New(env, resampler, finalizeResampler);
}

Napi::Value resampleChunk(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 4 || !info[1].IsBuffer() || !info[2].IsNumber() || !info[3].IsFunction()) {
    throw Napi::Error::New(env, "Should get 4 arguments: resamplerInstance, chunk, channels and callback");
  }

  SpeexResamplerState *resampler = info[0].As<Napi::External<SpeexResamplerState>>().Data();
  Napi::Buffer<int16_t> inBuffer = info[1].As<Napi::Buffer<int16_t>>();
  uint32_t inRate;
  uint32_t outRate;
  int channels = info[2].As<Napi::Number>().Int32Value();

  speex_resampler_get_rate(resampler, &inRate, &outRate);

  uint64_t inBufferLength = inBuffer.Length();
  uint64_t outSize = ((outRate * inBufferLength) / inRate); // this is the number of bytes that can be written

  uint32_t inSamples = inBufferLength / channels; // this is the number of samples per channel

  Napi::Function callback = info[3].As<Napi::Function>();

  ResamplerWorker* worker = new ResamplerWorker(callback, resampler, channels, inBuffer, outSize);

  worker->Queue();

  return env.Undefined();
}

ResamplerWorker::ResamplerWorker(Napi::Function& callback,
  SpeexResamplerState *resampler,
  int channels,
  Napi::Buffer<int16_t> inBuffer,
  uint32_t outSize)
: AsyncWorker(callback),
  channels(channels),
  inBuffer(inBuffer),
  resampler(resampler),
  outSize(outSize)
{
  this->outBuffer = new int16_t[this->outSize];
}

ResamplerWorker::~ResamplerWorker() {
  delete this->outBuffer;
}

void ResamplerWorker::Execute() {
  uint32_t inLen = this->inBuffer.Length() / this->channels; // number of samples (16 bits) per channel
  uint32_t outLen = this->outSize / this->channels; // size in byte of the output buffer per channel

  // std::cout << "inLen " << inLen << "\n";
  // std::cout << "outLen " << outLen << "\n";

  int err = speex_resampler_process_interleaved_int(
    this->resampler,
    this->inBuffer.Data(),
    &inLen,
    this->outBuffer,
    &outLen
  );

  if (err != 0) {
    Napi::AsyncWorker::SetError("Unknown error while parsing chunk");
  }

  // std::cout << "after inLen " << inLen << "\n";
  // std::cout << "after outLen " << outLen << "\n";

  // outLen is the number of samples written (2 bytes) per channel
  this->outSize = (outLen * this->channels);
}


void ResamplerWorker::OnOK() {
  Napi::HandleScope scope(this->Env());

  this->Callback().Call({
    this->Env().Null(),
    Napi::Buffer<int16_t>::Copy(
      this->Env(),
      this->outBuffer,
      this->outSize
    )
  });
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "createResampler"), Napi::Function::New(env, createResampler));
  exports.Set(Napi::String::New(env, "resampleChunk"), Napi::Function::New(env, resampleChunk));
  return exports;
}

NODE_API_MODULE(speex, InitAll)
