# QA Report · Phase 3 Runtime Reference — Historical Snapshot

- 대상: `Game_System_Framework_Knowledge_Site_Phase3_Runtime_Reference`
- 판본: `3.2.0-reference`
- 스냅샷 실행일: 2026-07-10
- 당시 결과: **PASS**

> 이 문서는 `3.2.0-reference` 당시의 검증 스냅샷이다. 현재 인수인계 기준과 최신 검증 수치는 `DEVELOPMENT_WORKFLOW.md`를 따르며, 현재 상태는 `npm run qa`로 다시 확인한다.

---

## 1. 종합 결과

| 검사 영역 | 결과 |
|---|---:|
| Runtime regression tests | **21 / 21 PASS** |
| Static site validation | **0 errors / 0 warnings** |
| Browser smoke checks | **109 / 109 PASS** |
| HTML pages | 16 |
| Search entries | 325 |
| Diagram parity | 34 DOT / 34 SVG / 34 PNG |
| Contract schemas | 4 |
| ADRs | 5 |
| Browser/source kernel parity | byte-identical |

최종 검증 명령:

```bash
npm run qa
```

---

## 2. Runtime 테스트 범위

21개 테스트가 다음을 확인했다.

1. 동일 입력 replay/trace/final state 일치
2. golden fixture exact match
3. keyed RNG 소비 순서 독립성
4. resolve의 snapshot/input 불변성
5. duplicate command 거부와 state 유지
6. stale version plan 거부
7. operation 실패 시 atomic rollback
8. ReactionQueue stable ordering
9. ReactionQueue budget 상한
10. 128 seed damage conservation sweep
11. Burn +2/+4/+6 tick-before-expire
12. miss의 비용/쿨다운 commit과 무피해
13. domain event correlation/causation metadata
14. canonical key order 독립성
15. namespaced ID validation
16. status catch-up budget와 만료 정리
17. contextual cache의 target/distance 분리
18. ownerVersion/invalidation 반영
19. v1→v2→v3 순차 migration과 audit hash
20. migration edge 누락 시 source 불변 거부
21. 극단 shield/HP/resistance 조합의 conservation gap 0

최종 실행 시간은 로컬 컨테이너 기준 약 **225 ms**였다. 이 값은 성능 벤치마크가 아니라 테스트 실행 참고치다.

---

## 3. 정적 무결성 검사

`source/tools/validate_site.py`가 다음을 검사했다.

- site-map의 16개 HTML 존재
- 각 페이지의 단일 H1, 단일 main, skip link
- 중복 HTML ID 없음
- 내부 링크·fragment·image·script·stylesheet 경로
- 모든 drawer에서 16개 문서 노출
- Runtime top navigation 존재
- 34개 DOT/SVG/PNG 파일 parity
- 갤러리 34개 card
- browser/source runtime kernel byte parity
- JSON Schema 4종과 fixture JSON parse
- ADR 5종
- Runtime Lab의 필수 selector
- search index page/section 포함 여부
- 외부 CDN/runtime asset 없음

결과: **0 errors, 0 warnings**.

---

## 4. Chromium smoke 검사

환경의 로컬 파일 navigation 제한 때문에 CSS, JS, image를 테스트 문서 안에 inline한 뒤 Chromium 144에서 실제 DOM과 인터랙션을 검사했다. 배포 패키지는 원래의 상대 경로 자산을 유지한다.

### 전체 페이지

16개 페이지를 다음 viewport에서 검사했다.

- Desktop: 1440 × 1000
- Mobile: 390 × 844

페이지마다 다음 3개 조건을 검사했다.

- 수평 overflow 없음
- JavaScript page error 없음
- H1 하나

### Runtime 인터랙션

- 초기 replay status `MATCH`
- Cache Lab `PASS`
- Migration Lab `PASS`
- Duplicate probe `PASS`
- Version conflict probe `PASS`
- Atomic rollback probe `PASS`
- seed 변경 뒤 replay 재실행 `MATCH`
- trace/event 목록 렌더링
- global search dialog와 Runtime 결과
- diagram modal open/close

총 결과: **109/109 PASS**.

---

## 5. 접근성·반응형 확인

자동 smoke와 정적 검사에서 다음을 확인했다.

- skip link와 main landmark
- 검색, drawer, 목차, 다이어그램의 native dialog
- form label과 output live region
- focus-visible 스타일
- reduced motion 대응
- 390px viewport 수평 overflow 없음
- 모바일 입력 field 재배치
- Runtime trace/event의 독립 scroll 영역

이는 정식 WCAG 적합성 인증이나 screen reader 전체 수동 테스트를 의미하지 않는다. NVDA/VoiceOver, Safari, Firefox, high zoom, locale별 수동 회귀는 배포 전 별도 게이트로 남아 있다.

---

## 6. 검증하지 않은 항목

- DB transaction isolation과 durable outbox 장애 복구
- 네트워크 prediction/reconciliation
- 분산 서버 및 멀티 shard
- 장시간 load/soak test
- 대규모 property/fuzz test
- Unity/Unreal runtime 통합
- Safari/Firefox 수동 상호작용
- 실제 사용자 대상 usability test

따라서 이번 PASS는 **reference package의 계약·정적 자산·Chromium 인터랙션**에 대한 결과다.
