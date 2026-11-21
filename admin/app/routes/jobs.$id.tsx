import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/jobs/$id")({ component: () => <p>任务详情</p> });
