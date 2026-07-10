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
