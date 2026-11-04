import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { DataSourceProvider } from "@/context/data-source";
import { RoleProvider } from "@/context/role";
import BatchesPage from "@/pages/batches";
import BranchesPage from "@/pages/branches";
import CallMinutesPage from "@/pages/call-minutes";
import CallsPage from "@/pages/calls";
import ComingSoonPage from "@/pages/coming-soon";
import CoursesPage from "@/pages/courses";
import DashboardPage from "@/pages/dashboard";
import EnrollmentsPage from "@/pages/enrollments";
import FollowUpsPage from "@/pages/follow-ups";
import InvoicesPage from "@/pages/invoices";
import LeadsPage from "@/pages/leads";
import PaymentsPage from "@/pages/payments";
import LeadDetailPage from "@/pages/leads/lead-detail";
import LeadFormPage from "@/pages/leads/lead-form";
import RecycleBinPage from "@/pages/leads/recycle-bin";
import LoginPage from "@/pages/login";
import ReportsPage from "@/pages/reports";
import ResetPasswordPage from "@/pages/reset-password";
import RolesPage from "@/pages/roles";
import SettingsPage from "@/pages/settings";
import StudentsPage from "@/pages/students";
import UsersPage from "@/pages/users";

export default function App() {
  return (
    <DataSourceProvider>
      <RoleProvider>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />

          {/* Leads — static prototype backed by mock data */}
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/new" element={<LeadFormPage />} />
          <Route path="/leads/recycle-bin" element={<RecycleBinPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/leads/:id/edit" element={<LeadFormPage />} />

          {/* Institute modules (live backend) */}
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/branches" element={<BranchesPage />} />

          {/* Planned lead-ops modules — navigation ready, pages pending */}
          <Route path="/follow-ups" element={<FollowUpsPage />} />
          <Route path="/enrollments" element={<EnrollmentsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          {/* Existing API-wired modules */}
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/batches" element={<BatchesPage defaultTab="slots" />} />
          <Route path="/courses/course-batches" element={<BatchesPage defaultTab="course-batches" />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/call-minutes" element={<CallMinutesPage />} />
          <Route path="*" element={<ComingSoonPage title="Not found" />} />
          </Route>
        </Routes>
      </RoleProvider>
    </DataSourceProvider>
  );
}
