#include <type_traits>

using type = typename std::remove_reference<int&>::type;
