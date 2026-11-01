const en = {
  stopped: 'Stopped locally. A server task may already exist; its final state has not been confirmed.',
  timeout: 'The request timed out. Existing server work may still be running; reload project status before starting again.',
  requestFailed: 'The request failed. Your brief is preserved.',
  draftChanged: 'This result belongs to the previous brief. The edited brief has not been submitted.',
  resultBrief: 'Brief used for this result',
  retry: 'Reload project data',
  loading: 'Loading project data…',
  assetsFailed: 'Project sources could not be loaded. Retained sources may be out of date.',
  workflowFailed: 'Project stage status could not be loaded. Retained status may be out of date.',
  activeFailed: 'The current project could not be loaded. Reload before starting a design task.',
  incomplete: 'The connection ended without a confirmed delivery status.',
  refreshOnly: 'Reload only reads project data; it does not run a design task.',
};
const zh: typeof en = {
  stopped: '已停止本地请求。服务器可能已建立任务，其最终状态尚未确认。',
  timeout: '请求超时。服务器已有任务可能仍在运行，请先重新读取项目状态，再决定是否发起任务。',
  requestFailed: '请求失败，需求草稿已保留。',
  draftChanged: '此结果属于此前的需求。修改后的需求尚未提交。',
  resultBrief: '此结果对应的需求',
  retry: '重新读取项目资料',
  loading: '正在读取项目资料…',
  assetsFailed: '项目来源资料加载失败。保留的资料可能已过时。',
  workflowFailed: '项目阶段状态加载失败。保留的状态可能已过时。',
  activeFailed: '当前项目加载失败，请重新读取后再发起设计任务。',
  incomplete: '连接已结束，但尚未收到确认的交付状态。',
  refreshOnly: '重新读取仅查询项目资料，不会执行设计任务。',
};
export const designerLifecycleCopy = (locale: string) => locale === 'en' ? en : zh;
