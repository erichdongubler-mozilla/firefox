/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "WebTaskSchedulerWorker.h"
#include "mozilla/dom/WorkerScope.h"
#include "mozilla/dom/TimeoutManager.h"

namespace mozilla::dom {
WebTaskWorkerRunnable::WebTaskWorkerRunnable(
    WebTaskSchedulerWorker* aSchedulerWorker)
    : WorkerSameThreadRunnable("WebTaskWorkerRunnable"),
      mSchedulerWorker(aSchedulerWorker) {
  MOZ_ASSERT(mSchedulerWorker);
}

RefPtr<WebTaskSchedulerWorker> WebTaskSchedulerWorker::Create(
    WorkerPrivate* aWorkerPrivate) {
  MOZ_ASSERT(aWorkerPrivate);
  aWorkerPrivate->AssertIsOnWorkerThread();

  RefPtr<WebTaskSchedulerWorker> scheduler =
      MakeRefPtr<WebTaskSchedulerWorker>(aWorkerPrivate);

  scheduler->mWorkerRef = StrongWorkerRef::Create(
      aWorkerPrivate, "WebTaskSchedulerWorker", [scheduler]() {
        // Set mWorkerIsShuttingDown as true here to avoid dispatching tasks
        // to worker thread.
        scheduler->mWorkerIsShuttingDown = true;
      });
  if (!scheduler->mWorkerRef) {
    NS_WARNING("Create WebTaskScheduler when Worker is shutting down");
    scheduler->mWorkerIsShuttingDown = true;
  }
  return scheduler;
}

WebTaskSchedulerWorker::WebTaskSchedulerWorker(WorkerPrivate* aWorkerPrivate)
    : WebTaskScheduler(aWorkerPrivate->GlobalScope()) {}

bool WebTaskWorkerRunnable::WorkerRun(JSContext* aCx,
                                      WorkerPrivate* aWorkerPrivate) {
  aWorkerPrivate->AssertIsOnWorkerThread();

  if (mSchedulerWorker) {
    RefPtr<WebTask> task =
        mSchedulerWorker->GetNextTask(false /* aIsMainThread */);
    if (task) {
      task->Run();
    }
  }
  return true;
}

nsresult WebTaskSchedulerWorker::SetTimeoutForDelayedTask(
    WebTask* aTask, uint64_t aDelay, EventQueuePriority aPriority) {
  if (mWorkerIsShuttingDown) {
    return NS_ERROR_ABORT;
  }
  if (!mWorkerRef) {
    return NS_ERROR_UNEXPECTED;
  }

  WorkerPrivate* workerPrivate = mWorkerRef->Private();
  MOZ_ASSERT(workerPrivate);
  workerPrivate->AssertIsOnWorkerThread();

  JSContext* cx = nsContentUtils::GetCurrentJSContext();
  if (!cx) {
    return NS_ERROR_UNEXPECTED;
  }
  RefPtr<DelayedWebTaskHandler> handler =
      new DelayedWebTaskHandler(cx, this, aTask, aPriority);
  ErrorResult rv;

  int32_t delay = aDelay > INT32_MAX ? INT32_MAX : (int32_t)aDelay;
  workerPrivate->SetTimeout(cx, handler, delay,
                            /* aIsInterval */ false,
                            Timeout::Reason::eDelayedWebTaskTimeout, rv);
  return rv.StealNSResult();
}

bool WebTaskSchedulerWorker::DispatchEventLoopRunnable(
    EventQueuePriority aPriority) {
  // aPriority is unused at the moment, we can't control
  // the priorities for runnables on workers at the moment.
  //
  // This won't affect the correctness of this API because
  // WebTaskScheduler maintains its own priority queues.
  //
  // It's just that we can't interfere the ordering between
  // `WebTask` and other runnables.
  if (mWorkerIsShuttingDown) {
    return false;
  }

  if (!mWorkerRef) {
    return false;
  }
  MOZ_ASSERT(mWorkerRef->Private());
  mWorkerRef->Private()->AssertIsOnWorkerThread();

  RefPtr<WebTaskWorkerRunnable> runnable = new WebTaskWorkerRunnable(this);
  return runnable->Dispatch(mWorkerRef->Private());
}

void WebTaskSchedulerWorker::Disconnect() {
  if (mWorkerRef) {
    mWorkerRef = nullptr;
  }
  WebTaskScheduler::Disconnect();
}

void WebTaskSchedulerWorker::
    IncreaseNumNormalOrHighPriorityQueuesHaveTaskScheduled() {
  ++mNumHighPriorityQueuesHaveTaskScheduled;
}

void WebTaskSchedulerWorker::
    DecreaseNumNormalOrHighPriorityQueuesHaveTaskScheduled() {
  MOZ_ASSERT(mNumHighPriorityQueuesHaveTaskScheduled > 0);
  --mNumHighPriorityQueuesHaveTaskScheduled;
}

}  // namespace mozilla::dom
