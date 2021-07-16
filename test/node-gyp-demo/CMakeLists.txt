cmake_minimum_required(VERSION 2.8)

project(addon)

message(STATUS "operation system is ${CMAKE_SYSTEM}")

add_definitions(-std=c++11)
add_compile_options(-g)

include_directories(${CMAKE_JS_INC})
include_directories(.)

file(GLOB SOURCE_FILES addon.cpp)

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})
