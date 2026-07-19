# ADR-001 · 결정론적 산술과 Keyed RNG

- 상태: Accepted for reference implementation
- 범위: Combat / Stat / Replay

## 맥락

같은 root seed만 저장해도 호출 순서가 달라지면 순차 RNG stream의 소비 위치가 바뀔 수 있다. 부동소수점과 반올림 위치 역시 플랫폼별 차이와 미세한 회귀를 만든다.

## 결정

1. 전투 수치는 safe integer로 보관한다.
2. 비율은 10,000 basis points를 사용하고 `integer-bps-half-away-from-zero-v1`에서 양수·음수 midpoint를 모두 0에서 멀어지는 방향으로 반올림한다.
3. 확률은 `(rootSeed, correlationId, decisionName, targetId, algorithmVersion)`을 key로 하는 stateless sample로 구한다.
4. replay header에 RNG와 numeric policy version을 기록한다.
5. canonical JSON과 FNV-1a 64-bit hash는 reference fixture의 재현성 표식으로만 사용한다.

## 결과

의사결정 추가·삭제가 다른 확률 roll을 이동시키지 않는다. 다만 FNV는 보안 hash가 아니며 신뢰 경계의 서명에는 별도 cryptographic hash가 필요하다.
