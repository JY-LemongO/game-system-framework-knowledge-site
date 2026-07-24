# 문서 상태 안내

이 디렉터리는 현재 작업 판단과 과거 검토 기록을 구분하는 인덱스다. 저장소의 현재 공개 계약은 실행 소스와 아래 current 문서를 기준으로 확인한다.

## Current

- [`../DEVELOPMENT_WORKFLOW.md`](../DEVELOPMENT_WORKFLOW.md): 브랜치, QA, 배포, Unity 호환성 정책
- [`../README.md`](../README.md): 공개 학습 범위와 저장소 구조
- [`../source/adr/`](../source/adr/): 현재 실행 정책의 Architecture Decision Records
- [`agent-reports/repository_review_feedback_triage_Plan.md`](agent-reports/repository_review_feedback_triage_Plan.md): 2026-07-22 피드백 판정과 이번 수정 범위

## Historical

- [`../QA_REPORT.md`](../QA_REPORT.md): 3.2.0-reference 당시 QA 스냅샷
- [`../source/qa/history/`](../source/qa/history/): release와 commit으로 식별한 과거 QA 결과
- `../PHASE2_*`, `../PHASE3_*`, `../ARCHITECTURE_AUDIT_AND_PHASE3_PLAN.md`, `../REVIEW_NOTES.md`: 작성 시점의 단계별 계획·검토 기록

Historical 문서의 PASS나 “현재” 표현은 해당 문서의 작성 시점에만 유효하다. 현재 commit의 상태는 대상 SHA의 `Repository QA` Actions 결과 또는 로컬 `npm run qa`로 확인한다.
