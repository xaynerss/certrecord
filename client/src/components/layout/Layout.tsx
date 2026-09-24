import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="min-h-screen bg-bg max-w-[1500px] mx-auto">
      <Sidebar />
      <main className="min-w-0 px-4 pt-[158px] pb-8 md:pt-6 md:pb-6 md:pl-[280px] md:pr-6">
        <Outlet />
      </main>
    </div>
  );
}
