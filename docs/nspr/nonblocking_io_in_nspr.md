# Nonblocking IO in NSPR

## Introduction

Previously, all I/O in the NetScape Portable Runtime (NSPR) was
*blocking* (or *synchronous*). A thread invoking an io function is
blocked until the io operation is finished. The blocking io model
encourages the use of multiple threads as a programming model. A thread
is typically created to attend to one of the simultaneous I/O operations
that may potentially block.

In the *nonblocking* io model, a file descriptor may be marked as
nonblocking. An io function on a nonblocking file descriptor either
succeeds immediately or fails immediately with
`PR_WOULD_BLOCK_ERROR`. A single thread is sufficient to attend
to multiple nonblocking file descriptors simultaneously. Typically, this
central thread invokes `PR_Poll()` on a set of nonblocking file
descriptors. (Note: `PR_Poll()` also works with blocking file
descriptors, although it is less useful in the blocking io model.) When
`PR_Poll()` reports that a file descriptor is ready for some io
operation, the central thread invokes that io function on the file
descriptor.

(creating-a-nonblocking-socket)=

## Creating a Nonblocking Socket

*Only sockets can be made nonblocking*. Regular files always operate in
blocking mode. This is not a serious constraint as one can assume that
disk I/O never blocks. Fundamentally, this constraint is due to the fact
that nonblocking I/O and `select()` are only available to sockets
on some platforms (e.g., Winsock).

In NSPR, a new socket returned by `PR_NewTCPSocket()` or
`PR_NewUDPSocket()` is always created in blocking mode. One can
make the new socket nonblocking by using `PR_SetSockOpt()` as in
the example below (error checking is omitted for clarity):

`PRFileDesc \*sock;`

## `PRIntn optval = 1;`

`sock = PR_NewTCPSocket();`

```
/*
* Make the socket nonblocking
*/

PR_SetSockOpt(sock, PR_SockOpt_Nonblocking, &optval, sizeof(optval));
```

(programming-constraints)=

## Programming Constraints

There are some constraints due to the use of NT asynchronous I/O in the
NSPR. In NSPR, blocking sockets on NT are associated with an I/O
completion port. Once associated with an I/O completion port, we can't
disassociate the socket from the I/O completion port. I have seen some
strange problems with using a nonblocking socket associated with an I/O
completion port. So the first constraint is:

**The blocking/nonblocking io mode of a new socket is committed the
first time a potentially-blocking io function is invoked on the
socket. Once the io mode of a socket is committed, it cannot be
changed.**

The potentially-blocking io functions include `PR_Connect()`,
`PR_Accept()`, `PR_AcceptRead()`, `PR_Read()`,
`PR_Write()`, `PR_Writev()`, `PR_Recv()`,
`PR_Send()`, `PR_RecvFrom()`, `PR_SendTo()`, and
`PR_TransmitFile(),` and do not include `PR_Bind()` and
`PR_Listen()`.

In blocking mode, any of these potentially-blocking functions requires
the use of the NT I/O completion port. So at that point we must
determine whether to associate the socket with the I/O completion or
not, and that decision cannot be changed later.

There is a second constraint, due to the use of NT asynchronous I/O and
the recycling of used sockets:

**The new socket returned by `PR_Accept()` or
`PR_AcceptRead()` inherits the blocking/nonblocking io mode of
the listening socket and this cannot be changed.**

The socket returned by `PR_Accept()` or `PR_AcceptRead()`
on a blocking, listening socket may be a recycled socket previously used
in a `PR_TransmitFile()` call. Since `PR_TransmitFile()`
only operates in blocking mode, this recycled socket can only be reused
in blocking mode, hence the above constraint.

Because these constraints only apply to NT, it is advised that you test
your cross-platform code that uses nonblocking io on NT early in the
development cycle. These constraints are enforced in the debug NSPR
library by assertions.

(differences-from-blocking-io)=

## Differences from Blocking IO

- In nonblocking mode, the timeout argument for the io functions is
  ignored.
- `PR_AcceptRead()` and `PR_TransmitFile()` only work on
  blocking sockets. They do not make sense in nonblocking mode.
- `PR_Write()`, `PR_Send()`, `PR_Writev()` in
  blocking mode block until the entire buffer is sent. In nonblocking
  mode, they cannot block, so they may return with just sending part of
  the buffer.

(pr-poll-or-pr-select)=

## PR_Poll() or PR_Select()?

`PR_Select()` is deprecated, now declared in
`private/pprio.h`. Use `PR_Poll()` instead.

The current implementation of `PR_Select()` simply calls
`PR_Poll()`, so it is sure to have worse performance. Also,
native file descriptors (socket handles) cannot be added to
`PR_fd_set`, i.e., the functions `PR_FD_NSET`,
`PR_FD_NCLR`, `PR_FD_NISSET` do not work.

## PR_Available()

When `PR_Available()` returns 0, it may mean one of two things:

- There is no data available for reading on that socket. I.e.,
  `PR_Recv()` would block (a blocking socket) or fail with
  `PR_WOULD_BLOCK_ERROR` (a nonblocking socket).
- The TCP connection on that socket has been closed (end of stream).

These two cases can be distinguished by `PR_Poll()`. If
`PR_Poll()` reports that the socket is readable (i.e.,
`PR_POLL_READ` is set in `out_flags`), and
`PR_Available()` returns 0, this means that the socket connection
is closed.

(current-status)=

## Current Status

Implemented across all supported platforms.
