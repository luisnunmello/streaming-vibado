import { Routes } from '@angular/router';
import { Viewer } from './viewer/viewer';
import { Admin } from './admin/admin';

export const routes: Routes = [
  { path: '', component: Viewer, title: 'Live stream' },
  { path: 'admin', component: Admin, title: 'Admin · Streaming' },
  { path: '**', redirectTo: '' },
];
