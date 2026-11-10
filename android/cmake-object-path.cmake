# CMake 3.22 on Windows still emits ninja mkdir for full source-derived
# object dirs unless this is set before project() via `cmake -C`.
set(CMAKE_OBJECT_PATH_MAX 180 CACHE STRING "Keep ninja object paths under Windows 260" FORCE)
