# Phase 3 Runtime Reference Kernel

이 디렉터리는 지식 사이트의 Phase 3 설계 계약을 실행 가능한 형태로 고정한 **엔진 비종속 reference implementation**이다. 브라우저의 Runtime Workbench와 Node 테스트가 동일한 `runtime-kernel.js`를 사용한다.

## 구현 범위

- Command/Event envelope와 namespaced identity
- 정수·basis-point 산술과 keyed deterministic RNG
- 순수한 Fireball resolve와 optimistic precondition
- HP/Shield/비용/쿨다운의 all-or-nothing commit
- post-commit domain event outbox
- bounded deterministic ReactionQueue
- commit·clock 재진입 차단, trace payload 동결 snapshot, trace observer의 queue enqueue 차단
- exact-v1 공개 입력의 단일 canonical clone, `__proto__` 보존, sparse/accessor 등 비-JSON container 거부
- Burn 적용, 적용 Skill과 실행 Status의 SourceRef 분리, 직전 status event 기반 causation, fixed tick, tick-before-expire, catch-up budget
- restore·status add·status patch 전 구간의 applied/next tick 단조성 검증
- context fingerprint 기반 Stat query cache
- 순차 N−2 schema migration registry와 audit hash
- replay hash, trace hash, golden fixture

`createCommandEnvelope`과 `createDomainEventEnvelope`은 생략 가능한 기본값을 채우는 convenience builder다. 외부 wire object는 모든 canonical 필드를 요구하고 unknown field를 거부하는 `parseCommandEnvelope`과 `parseDomainEventEnvelope`을 통과해야 한다.

## 실행

```bash
node source/runtime/run-demo.cjs
node source/runtime/run-migration-demo.cjs
node source/runtime/tests/runtime-kernel.test.cjs
```

사이트 루트에서는 다음 명령도 사용할 수 있다.

```bash
npm test
npm run qa
```

## 의도적인 제한

이 커널은 계약 검증용 단일 프로세스·메모리 구현이다. 데이터베이스 transaction, durable outbox, 네트워크 prediction/reconciliation, 멀티 타깃 AoE, authoritative server adapter, 엔진 resource/animation adapter는 다음 생산 구현 단계의 포트로 남겨 두었다.
