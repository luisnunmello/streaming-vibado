export interface BugReportView {
  id: number;
  title: string;
  description: string;
  reporter: string;
  page: string;
  userAgent: string;
  version: string;
  fixedIn: string;
  status: 'open' | 'solved';
  adminNote: string;
  hasShot: boolean;
  createdAt: number;
  updatedAt: number;
  solvedAt: number | null;
}
