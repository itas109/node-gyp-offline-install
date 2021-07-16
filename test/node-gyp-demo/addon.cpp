#include <node_api.h>

static napi_value helloMethod(napi_env env, napi_callback_info info)
{
    napi_value result;
    napi_create_string_utf8(env, "hello world", NAPI_AUTO_LENGTH, &result);

    return result;
}

static napi_value Init(napi_env env, napi_value exports)
{
    napi_property_descriptor desc = {"hello", 0, helloMethod, 0, 0, 0, napi_default, 0};
    napi_define_properties(env, exports, 1, &desc);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)