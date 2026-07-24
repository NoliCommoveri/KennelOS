// training.js — PLACEHOLDER page. Training content (a puppy curriculum: house
// manners, basic cues, socialization milestones) needs research before it's built,
// so for now this is just a "coming soon" card. It keeps the same active-pet shell
// as the other pet pages so the Training tab isn't a dead link, and so the real
// page can drop straight in later.
import { petRepo } from '../data/petRepo.js';
import { getActivePetId } from '../data/settings.js';
import { esc, showError } from '../assets/ui.js';

const body = document.getElementById('training-body');

async function render() {
  try {
    const petId = getActivePetId();
    const pet = petId ? await petRepo.getById(petId) : null;
    if (!pet) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pet selected</h2>
        <p>Pick a pet from the menu, or add your first one.</p>
        <p><a class="btn btn-primary" href="addpet.html">Add New Pet</a></p>
      </div>`;
      return;
    }
    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Training</h1>
          <p class="page-subtitle">${esc(pet.name)}'s training.</p>
        </div>
      </div>
      <div class="card empty-state">
        <span class="big" aria-hidden="true">🎓</span>
        <h2>Coming soon</h2>
        <p>A puppy training guide — house manners, basic cues, and socialization
           milestones timed to ${esc(pet.name)}'s age — is on the way.</p>
      </div>`;
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

render();
