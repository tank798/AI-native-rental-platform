-- 任务删除改为软删除，保留举报与审计链路。
--
-- 背景：reports.match_case_id -> match_cases(id) ON DELETE CASCADE，
-- 而 match_cases.renter_task_id / supply_task_id -> tasks(id) ON DELETE CASCADE，
-- 且 PRAGMA foreign_keys = ON。因此物理删除 tasks 会级联销毁 match_cases、
-- 条款、确认、看房安排、联系人授权快照以及 reports 本身，
-- 使被举报方只要删除自己的任务即可清除对自己不利的全部证据。
--
-- 软删除保留行与外键关系，同时清空业务载荷以满足用户的数据删除诉求。

ALTER TABLE tasks ADD COLUMN deleted_at TEXT;

CREATE INDEX tasks_owner_deleted_idx ON tasks(owner_id, deleted_at, created_at DESC);
