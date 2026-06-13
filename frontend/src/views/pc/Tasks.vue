<template>
  <el-container class="tasks-container">
    <el-main>
      <el-card class="tasks-card">
        <template #header>
          <div class="card-header">
            <el-row>
              <el-col :span="12" style="text-align: left">
                <span>任务管理</span>
                <span class="job-count">共 {{ jobs.length }} 个任务</span>
              </el-col>
              <el-col :span="12" style="text-align: right">
                <el-button
                  type="primary"
                  :loading="loading"
                  @click="refreshJobs"
                  class="refresh-btn"
                >
                  <i class="bi bi-arrow-clockwise"></i>
                  <span>刷新</span>
                </el-button>
              </el-col>
            </el-row>
          </div>
        </template>

        <el-table
          :data="jobs"
          stripe
          empty-text="暂无任务"
          style="width: 100%"
          :row-class-name="tableRowClassName"
        >
          <el-table-column type="expand">
            <template #default="props">
              <div class="expand-content">
                <el-descriptions :column="1" border size="small">
                  <el-descriptions-item label="任务ID">
                    {{ props.row.id || '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="任务描述">
                    {{ props.row.desc || '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="当前提示">
                    {{ props.row.tip || '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="创建时间">
                    {{ formatTime(props.row.createdAt) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="进度" v-if="props.row.progress !== undefined">
                    <el-progress
                      :percentage="Math.round((props.row.progress || 0) * 100)"
                      :status="getProgressStatus(props.row.status)"
                      :stroke-width="10"
                    />
                  </el-descriptions-item>
                </el-descriptions>

                <div v-if="props.row.logs && props.row.logs.length > 0" class="logs-section">
                  <div class="logs-title">任务日志</div>
                  <el-timeline>
                    <el-timeline-item
                      v-for="(log, index) in props.row.logs.slice().reverse()"
                      :key="index"
                      :timestamp="formatTime(log.time)"
                      placement="top"
                    >
                      {{ log.info }}
                    </el-timeline-item>
                  </el-timeline>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="任务名称" min-width="200">
            <template #default="scope">
              <div class="job-name">
                <i class="bi bi-file-earmark-text" style="margin-right: 8px"></i>
                <span>{{ scope.row.name }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="类型" width="140">
            <template #default="scope">
              <el-tag size="small" :type="getTypeTagType(scope.row.type)">
                {{ getTypeLabel(scope.row.type) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="120">
            <template #default="scope">
              <el-tag size="small" :type="getStatusTagType(scope.row.status)">
                {{ scope.row.status }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="进度" width="200">
            <template #default="scope">
              <el-progress
                :percentage="Math.round((scope.row.progress || 0) * 100)"
                :status="getProgressStatus(scope.row.status)"
                :stroke-width="12"
              />
            </template>
          </el-table-column>

          <el-table-column label="创建时间" width="180">
            <template #default="scope">
              <span class="time-text">{{ formatTime(scope.row.createdAt) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button
                size="small"
                type="danger"
                text
                @click="handleDelete(scope.row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-main>
  </el-container>
</template>

<script>
import { getAllJobs, deleteJob } from "../../api";
import { ElMessage, ElMessageBox } from "element-plus";

const StatusPending = "待开始";
const StatusInProgress = "进行中";
const StatusFinished = "已完成";
const StatusFailed = "失败";

const JobTypeLabels = {
  SyncSongFromUrl: "上传歌曲",
  DownloadSongFromUrl: "下载歌曲",
  UnblockedPlaylist: "解锁歌单",
  UnblockedSong: "解锁单曲",
  SyncThePlaylistToLocalService: "同步歌单到本地",
};

export default {
  data: () => {
    return {
      jobs: [],
      loading: false,
      autoRefreshTimer: null,
    };
  },
  async mounted() {
    await this.refreshJobs();
    this.startAutoRefresh();
  },
  beforeUnmount() {
    this.stopAutoRefresh();
  },
  methods: {
    async refreshJobs() {
      this.loading = true;
      try {
        const ret = await getAllJobs();
        if (ret && ret.data && ret.data.jobs) {
          this.jobs = ret.data.jobs;
        }
      } catch (e) {
        ElMessage.error("获取任务列表失败");
      } finally {
        this.loading = false;
      }
    },
    startAutoRefresh() {
      if (this.autoRefreshTimer) {
        return;
      }
      this.autoRefreshTimer = setInterval(() => {
        const hasActiveJob = this.jobs.some(
          (j) => j.status === StatusPending || j.status === StatusInProgress
        );
        if (hasActiveJob) {
          this.refreshJobs();
        }
      }, 3000);
    },
    stopAutoRefresh() {
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = null;
      }
    },
    async handleDelete(row) {
      const jobId = row.id;
      if (!jobId) {
        ElMessage.warning("无法获取任务ID");
        return;
      }
      try {
        await ElMessageBox.confirm(
          `确认删除任务「${row.name}」？此操作不可恢复。`,
          "确认删除",
          {
            confirmButtonText: "删除",
            cancelButtonText: "取消",
            type: "warning",
          }
        );
      } catch (e) {
        return;
      }
      const ret = await deleteJob(jobId);
      if (ret && ret.status === 0) {
        ElMessage.success("删除成功");
        await this.refreshJobs();
      } else {
        ElMessage.error("删除失败");
      }
    },
    getStatusTagType(status) {
      if (status === StatusFinished) return "success";
      if (status === StatusFailed) return "danger";
      if (status === StatusInProgress) return "primary";
      if (status === StatusPending) return "info";
      return "info";
    },
    getProgressStatus(status) {
      if (status === StatusFinished) return "success";
      if (status === StatusFailed) return "exception";
      return null;
    },
    getTypeTagType(type) {
      if (!type) return "info";
      if (type === "DownloadSongFromUrl") return "warning";
      if (type === "SyncSongFromUrl") return "success";
      if (type === "UnblockedPlaylist" || type === "UnblockedSong") return "danger";
      if (type === "SyncThePlaylistToLocalService") return "primary";
      return "info";
    },
    getTypeLabel(type) {
      return JobTypeLabels[type] || type || "未知";
    },
    formatTime(timestamp) {
      if (!timestamp) return "-";
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return "-";
      const pad = (n) => (n < 10 ? "0" + n : n);
      return (
        date.getFullYear() +
        "-" +
        pad(date.getMonth() + 1) +
        "-" +
        pad(date.getDate()) +
        " " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes()) +
        ":" +
        pad(date.getSeconds())
      );
    },
    tableRowClassName({ row }) {
      if (row.status === StatusFailed) return "row-failed";
      if (row.status === StatusFinished) return "row-finished";
      return "";
    },
  },
};
</script>

<style scoped>
.tasks-container {
  margin-top: 20px;
}

.tasks-card {
  margin: 0 auto;
  max-width: 1200px;
}

.card-header {
  width: 100%;
}

.job-count {
  color: #909399;
  font-size: 12px;
  margin-left: 12px;
  font-weight: normal;
}

.refresh-btn {
  margin-left: 12px;
}

.job-name {
  display: flex;
  align-items: center;
  color: #303133;
  font-weight: 500;
}

.time-text {
  color: #606266;
  font-size: 12px;
}

.expand-content {
  padding: 10px 20px;
}

.logs-section {
  margin-top: 16px;
}

.logs-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 12px;
}

:deep(.row-failed) {
  background-color: rgba(254, 240, 240, 0.5);
}

:deep(.row-finished) {
  background-color: rgba(240, 249, 235, 0.3);
}
</style>
