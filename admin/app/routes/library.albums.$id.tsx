import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library/albums/$id")({ component: () => <p>专辑</p> });
