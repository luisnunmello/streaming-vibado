import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogHost } from './shared/dialog-host';

@Component({
  imports: [RouterOutlet, DialogHost],
  selector: 'app-root',
  template: '<router-outlet /><app-dialog-host />',
})
export class App {}
