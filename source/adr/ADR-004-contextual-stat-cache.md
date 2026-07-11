# ADR-004 · Context Fingerprint 기반 Stat Cache

- 상태: Accepted for reference implementation
- 범위: Stat / Modifier

## 맥락

대상 태그, 거리, 스킬 태그를 참조하는 Modifier의 값을 owner 단일 cachedValue에 저장하면 다른 대상에 잘못 재사용된다.

## 결정

- cache caller가 실제로 읽는 context path를 선언한다.
- 선언된 값만 canonicalize해 ContextFingerprint를 만든다.
- key는 entityId, statId, ownerVersion, contextFingerprint의 hash다.
- ownerVersion이 달라지면 자동으로 다른 key가 되며, entity 단위 명시적 invalidation도 제공한다.
- bounded LRU로 메모리 상한을 둔다.

## 결과

조건부 계산을 안전하게 재사용할 수 있다. dependency 누락은 correctness bug이므로 개발 환경에서 read tracking 또는 선언 검증을 추가하는 것이 다음 단계다.
