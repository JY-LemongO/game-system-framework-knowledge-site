# ADR-005 · Sequential N−2 Schema Migration

- 상태: Accepted for reference implementation
- 범위: Save / Definition / Replay compatibility

## 맥락

버전별 직접 변환을 모두 유지하면 조합이 폭증하고 어느 변환을 거쳤는지 감사하기 어렵다.

## 결정

- migration은 `vN → vN+1` 단일 edge만 등록한다.
- 기본 지원 창은 current version의 N−2까지다.
- source document를 clone/freeze한 뒤 pure migration을 호출한다.
- 각 단계의 migrationId, beforeHash, afterHash를 audit record로 남긴다.
- edge가 없거나 output version이 맞지 않으면 전체 migration을 거부한다.

## 결과

경로가 단순하고 테스트 가능하다. 실제 저장소에서는 백업, batch retry, telemetry, rollback 운영 절차를 추가해야 한다.

## 고려한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| 모든 과거 버전에서 current로 직접 변환 | 지원 버전 수가 늘수록 edge와 중복 로직이 빠르게 증가하고 중간 변환의 감사 기록을 잃는다. |
| 읽을 때마다 여러 schema를 영구 지원 | domain 코드 전체에 버전 분기가 퍼지고 current invariant가 약해진다. |
| 알 수 없는 edge를 건너뛰는 best effort | 일부 필드만 변환된 문서를 정상처럼 받아 저장 손상과 replay drift를 숨긴다. |
| 기존 migration을 사후 수정 | 이미 처리한 데이터와 새 처리 데이터가 같은 migration ID에서 다른 결과를 갖는다. 새 forward edge를 추가한다. |

N−2는 자연 법칙이 아니라 이 reference의 운영 예산이다. 더 긴 보존 의무가 있는 save game, replay, live-service 계정 데이터는 지원 창과 archival reader를 제품 요구에 맞게 별도 결정해야 한다.

## 재검토 조건

- 지원해야 할 save/replay 보존 기간이 N−2를 넘을 때
- migration 시간이 로그인·부팅 예산을 넘어서 offline batch가 필요할 때
- 한 단계 변환도 되돌릴 수 없는 데이터 손실을 포함할 때
- 여러 서비스가 서로 다른 current schema를 동시에 운영할 때
- checksum, 백업, canary, resume token을 갖춘 production migration runner를 도입할 때

## 외부 근거

- Redgate Flyway의 [Versioned migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations): version 순서대로 한 번 적용하고 checksum으로 이미 적용된 migration의 변경을 감지하며, 기존 migration 수정 대신 새 forward migration을 추가하는 운영 모델의 근거. 이 ADR은 DB 도구 자체를 채택하는 결정이 아니라 동일한 순차·감사 원칙을 save/definition/replay 문서에 적용한다.
