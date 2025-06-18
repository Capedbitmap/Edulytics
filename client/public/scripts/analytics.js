function openInstructorModal(_, lectureCode) {
  document.getElementById('instructor-modal').style.display = 'block';
  document.getElementById('lectureCodeDisplay').innerText = lectureCode;

  // Destroy any existing Chart.js instances on these canvas IDs
  Chart.getChart("teachingMethodChart")?.destroy();
  Chart.getChart("toneChart")?.destroy();
  Chart.getChart("languageChart")?.destroy();
  Chart.getChart("interactionChart")?.destroy();

  loadTeachingMethodChart(lectureCode);
  loadToneChart(lectureCode);
  loadLanguageChart(lectureCode);
  loadInteractionChart(lectureCode);
}


function closeInstructorModal() {
  document.getElementById('instructor-modal').style.display = 'none';
}

// Close modal when clicking outside
window.addEventListener('click', function (event) {
  if (event.target === document.getElementById('instructor-modal')) {
    closeInstructorModal();
  }
});

// Replace email special characters for Firebase-safe paths
function formatEmailForFirebase(email) {
  return email.replace(/\./g, "_dot_").replace(/@/g, "_at_");
}

// Chart for teaching method (behavior)
function loadTeachingMethodChart(lectureCode) {
  const ref = realtimeDatabase.ref("instructors");

  ref.once("value").then(snapshot => {
    const instructors = snapshot.val();
    if (!instructors) return;

    let found = false;

    for (const emailKey in instructors) {
      const lectures = instructors[emailKey];
      if (lectures[lectureCode]) {
        const data = lectures[lectureCode].behavior;
        if (!data) return;

        const labels = ["Standing", "Seated", "Writing", "Gesturing", "Roaming", "Smiling"];
        const values = [
          data.lecturing_standing || 0,
          data.lecturing_seated || 0,
          data.writing || 0,
          data.gesturing || 0,
          data.roaming || 0,
          data.smiling || 0
        ];

        new Chart(document.getElementById("teachingMethodChart"), {
          type: "pie",
          data: {
            labels,
            datasets: [{
              label: "Frame Count",
              data: values,
            }]
          }
        });

        found = true;
        break;
      }
    }

    if (!found) {
      console.warn("⚠️ Lecture code not found in any instructor branch:", lectureCode);
    }
  });
}


// Chart for voice tone (audio)
function loadToneChart(lectureCode) {
  const ref = realtimeDatabase.ref("instructors");

  ref.once("value").then(snapshot => {
    const instructors = snapshot.val();
    if (!instructors) return;

    let found = false;

    for (const emailKey in instructors) {
      const lectures = instructors[emailKey];
      if (lectures[lectureCode]) {
        const data = lectures[lectureCode].audio;
        if (!data) return;

        const labels = ["Silence", "Normal", "Loud"];
        const values = [
          data.silence || 0,
          data.normal || 0,
          data.loud || 0
        ];

        new Chart(document.getElementById("toneChart"), {
          type: "pie",
          data: {
            labels,
            datasets: [{
              label: "Tone Analysis",
              data: values
            }]
          }
        });

        found = true;
        break;
      }
    }

    if (!found) {
      console.warn("⚠️ Audio data not found for lecture:", lectureCode);
    }
  });
}

function loadLanguageChart(lectureCode) {
  const ref = realtimeDatabase.ref("instructors");
  ref.once("value").then(snapshot => {
    const instructors = snapshot.val();
    if (!instructors) return;

    let found = false;
    for (const emailKey in instructors) {
      const lectures = instructors[emailKey];
      if (lectures && lectures[lectureCode] && lectures[lectureCode].transcript_analysis) {
        const langData = lectures[lectureCode].transcript_analysis.language_counts;
        if (!langData) {
          console.warn("⚠️ No language_counts for lecture:", lectureCode);
          return;
        }
        // Extract counts (default to 0 if missing)
        const englishCount = langData.english || 0;
        const arabicCount  = langData.arabic  || 0;
        const totalLines   = langData.total_lines || (englishCount + arabicCount);
        // If total_lines is zero, we might skip or show empty chart
        if (totalLines === 0) {
          console.warn("ℹ️ No transcript lines to show language distribution for lecture:", lectureCode);
        }
        const labels = ["English", "Arabic"];
        const values = [englishCount, arabicCount];

        const ctx = document.getElementById("languageChart");
        new Chart(ctx, {
          type: "pie",
          data: {
            labels,
            datasets: [{
              label: "Language distribution",
              data: values
            }]
          },
          options: {
            plugins: {
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const label = context.label || '';
                    const value = context.raw || 0;
                    const pct = totalLines > 0 ? ((value / totalLines) * 100).toFixed(1) : "0";
                    return `${label}: ${value} (${pct}%)`;
                  }
                }
              }
            }
          }
        });

        found = true;
        break;
      }
    }
    if (!found) {
      console.warn("⚠️ Lecture code not found in any instructor branch for language chart:", lectureCode);
    }
  }).catch(err => {
    console.error("Error loading language data:", err);
  });
}
function loadInteractionChart(lectureCode) {
  const ref = realtimeDatabase.ref("instructors");
  ref.once("value").then(snapshot => {
    const instructors = snapshot.val();
    if (!instructors) return;

    let found = false;
    for (const emailKey in instructors) {
      const lectures = instructors[emailKey];
      if (lectures && lectures[lectureCode] && lectures[lectureCode].transcript_analysis) {
        const interData = lectures[lectureCode].transcript_analysis.interaction_counts;
        if (!interData) {
          console.warn("⚠️ No interaction_counts for lecture:", lectureCode);
          return;
        }
        const positiveCount = interData.positive || 0;
        const negativeCount = interData.negative || 0;
        const total = interData.total || (positiveCount + negativeCount);
        if (total === 0) {
          console.warn("ℹ️ No transcript lines to show interaction sentiment for lecture:", lectureCode);
        }
        const labels = ["Positive", "Negative"];
        const values = [positiveCount, negativeCount];

        const ctx = document.getElementById("interactionChart");
        new Chart(ctx, {
          type: "pie",
          data: {
            labels,
            datasets: [{
              label: "Interaction sentiment",
              data: values
            }]
          },
          options: {
            plugins: {
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const label = context.label || '';
                    const value = context.raw || 0;
                    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                    return `${label}: ${value} (${pct}%)`;
                  }
                }
              }
            }
          }
        });

        found = true;
        break;
      }
    }
    if (!found) {
      console.warn("⚠️ Lecture code not found in any instructor branch for interaction chart:", lectureCode);
    }
  }).catch(err => {
    console.error("Error loading interaction data:", err);
  });
}
