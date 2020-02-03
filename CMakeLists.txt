cmake_minimum_required(VERSION 3.10)
set (CMAKE_CXX_STANDARD 11)
project (speex-resampler)

include (./scripts/TargetArch.cmake)
target_architecture(CMAKE_TARGET_ARCHITECTURES)
message(STATUS "Target architectures: ${CMAKE_TARGET_ARCHITECTURES}")

include_directories(${CMAKE_JS_INC})

file(GLOB SOURCE_FILES "deps/speex/*.c" "deps/speex/*.h" "src/*.cc" "src/*.h")

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# Include N-API wrappers
execute_process(COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
)
string(REPLACE "\n" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR})

add_definitions(-DNAPI_VERSION=3)

# add_compile_definitions( FIXED_POINT=true )
add_compile_definitions( FLOATING_POINT=true )
add_compile_definitions( OUTSIDE_SPEEX=true )
add_compile_definitions( EXPORT= )

if( ${CMAKE_TARGET_ARCHITECTURES} STREQUAL "x86_64" )
  message(STATUS "Adding SSE support")
  add_compile_definitions(USE_SSE=true)
  add_compile_definitions(USE_SSE2=true)
endif()

