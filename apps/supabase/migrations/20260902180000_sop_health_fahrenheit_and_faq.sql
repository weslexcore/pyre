-- Third version of the health benefits SOP plus a new 'Customer FAQ' section.
--
--   * The guide now gives every temperature in Fahrenheit, matching the
--     thermometers on the floor and the public site (saunas 170 to 195°F,
--     plunges 39 to 50°F). Cited study temperatures are converted, not
--     re-sourced. Recorded as a versioned save, guarded on the document
--     still carrying Celsius so an already-converted copy is untouched.
--   * A 'Customer FAQ' section for the questions guests ask most, seeded with
--     ten sauna and cold plunge questions. Each answer is a short line staff
--     can say out loud, a 'why' paragraph, study links, and an in-library
--     link to the relevant part of the health guide (opens in the peek
--     modal). Durations and temperatures match the public FAQ and the
--     Health & Safety page on the landing site.
--
-- Every statement is guarded so a re-run is a no-op.

with updated as (
  update public.sops
  set
    content_md = $health3$*A quick reference for answering guest questions, backed by the research it comes from. Scan the first half for the bottom line; follow the links when you want the detail or the study itself.*

## Quick reference

Each line below gives the takeaway, an evidence tag, a link to the detail further down, and the studies behind it.

- **Strong** means large long-term studies or randomised trials with consistent results.
- **Moderate** means one good trial, or several small ones pointing the same way.
- **Early** means surveys, very small studies, or a mechanism that has not yet been tested as an outcome.

Nothing here is a treatment for any disease. A guest with a heart condition, on blood pressure medication, or pregnant should check with their doctor first.

### Sauna at a glance

- **Heart and circulation.** People who sauna 4 to 7 times a week have far lower rates of sudden cardiac death, cardiovascular death, and stroke than once-a-week users, and about half the risk of developing high blood pressure. A single session lowers blood pressure for at least 30 minutes afterwards. Strong. [Detail](#sauna-heart-and-circulation) · [[1]](https://pubmed.ncbi.nlm.nih.gov/25705824/) [[2]](https://pubmed.ncbi.nlm.nih.gov/30486813/) [[3]](https://pubmed.ncbi.nlm.nih.gov/29720543/) [[4]](https://pubmed.ncbi.nlm.nih.gov/28633297/) [[5]](https://pubmed.ncbi.nlm.nih.gov/29048215/)
- **Brain.** Frequent use is linked to about two-thirds lower risk of dementia and Alzheimer's, and a lower risk of psychotic disorders. Heat has eased depression in one small trial. Strong for the dementia link, Early for depression. [Detail](#sauna-brain) · [[6]](https://pubmed.ncbi.nlm.nih.gov/27932366/) [[7]](https://pubmed.ncbi.nlm.nih.gov/30173212/) [[8]](https://pubmed.ncbi.nlm.nih.gov/27172277/)
- **Lungs.** Four or more sessions a week is linked to 41% fewer hospital-diagnosed lung illnesses such as pneumonia. Moderate. [Detail](#sauna-lungs) · [[9]](https://pubmed.ncbi.nlm.nih.gov/28905164/)
- **Sleep and relaxation.** Most regular users say they sleep better and go mainly to relax and unwind. This is what people report, not a controlled trial. Early. [Detail](#sauna-sleep-relaxation-and-well-being) · [[10]](https://pubmed.ncbi.nlm.nih.gov/31126560/) [[11]](https://pubmed.ncbi.nlm.nih.gov/29849692/)
- **How often, how long.** The biggest differences show up at four or more sessions a week and sessions over 19 minutes. Two to three sessions a week showed smaller differences that often did not reach significance. [[1]](https://pubmed.ncbi.nlm.nih.gov/25705824/)
- **Why it works.** The heat load resembles moderate exercise: blood vessels relax, arteries get more flexible, and the body makes heat shock proteins that help cells repair. [Detail](#sauna-how-it-may-work) · [[12]](https://pubmed.ncbi.nlm.nih.gov/30077204/) [[13]](https://pubmed.ncbi.nlm.nih.gov/34363927/)

### Cold plunge at a glance

- **Alertness and energy.** Cold water triggers a large surge of noradrenaline and dopamine, which is the clear-headed feeling afterwards. Strong for the response itself, from a small but consistently replicated physiology study. [Detail](#cold-stress-hormones-and-alertness) · [[14]](https://pubmed.ncbi.nlm.nih.gov/10751106/)
- **Stress.** A meta-analysis of 11 trials found lower perceived stress 12 hours after a plunge. Moderate. [Detail](#cold-stress-hormones-and-alertness) · [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/)
- **Mood.** A single plunge measurably lifts mood, and regular winter swimmers report less tension and fatigue over a season. Moderate. [Detail](#cold-mood) · [[16]](https://doi.org/10.1002/lim2.53) [[17]](https://pubmed.ncbi.nlm.nih.gov/36829490/) [[18]](https://pubmed.ncbi.nlm.nih.gov/15253480/)
- **Sick days.** Thirty days of cold showers cut sick days by 29% in a trial of 3,000 adults, though people got ill just as often. Moderate. [Detail](#cold-immunity-and-sick-days) · [[19]](https://pubmed.ncbi.nlm.nih.gov/27631616/) [[20]](https://pubmed.ncbi.nlm.nih.gov/24799686/)
- **Muscle soreness.** Cold reduces soreness after hard exercise, but a plunge straight after strength training blunts muscle and strength gains. Moderate for both. [Detail](#cold-muscles-and-recovery) · [[21]](https://pubmed.ncbi.nlm.nih.gov/22336838/) [[22]](https://pubmed.ncbi.nlm.nih.gov/26174323/)
- **Metabolism.** Cold activates brown fat and improved insulin sensitivity in a tiny diabetes study, but these used cool air, not water. Early. [Detail](#cold-metabolism) · [[23]](https://pubmed.ncbi.nlm.nih.gov/23867626/) [[24]](https://pubmed.ncbi.nlm.nih.gov/26147760/)
- **Sleep.** The one controlled trial found no effect. Say "many people find they sleep better," not "it improves sleep." [[28]](https://pubmed.ncbi.nlm.nih.gov/23377833/)
- **How long, how cold.** Trials mostly use 50 to 59°F water for one to ten minutes. First-timers should think in seconds, not minutes, and build up over visits. [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/) [[32]](https://pubmed.ncbi.nlm.nih.gov/31702722/)

### Cold plunge for women at a glance

- **Same benefits, thinner evidence.** The mood, alertness, and stress findings above came from mixed groups, so they apply to women, but most cold physiology research was done on men and only 6% of sport science studies are women-only. Moderate for the benefits, with a real research gap. [Detail](#women-what-the-research-covers) · [[49]](https://doi.org/10.1123/wspaj.2021-0028)
- **Body composition, not sex, sets how fast you cool.** Women cooled at half the rate of men in one study, but the gap vanished once body fat was matched. Women hold heat by insulation; men by shivering. No study shows a sex difference in the cold shock response itself. Moderate. [Detail](#women-cooling-body-composition-and-cold-shock) · [[36]](https://pubmed.ncbi.nlm.nih.gov/11007575/) [[37]](https://pubmed.ncbi.nlm.nih.gov/24809633/) [[38]](https://pubmed.ncbi.nlm.nih.gov/35655670/)
- **No need to time plunges to the menstrual cycle.** Core temperature runs 0.5 to 1.3°F higher in the second half of the cycle, but every direct test of cold immersion across the cycle found no difference in response. Moderate. [Detail](#women-the-menstrual-cycle) · [[39]](https://pubmed.ncbi.nlm.nih.gov/33123618/) [[40]](https://pubmed.ncbi.nlm.nih.gov/10902935/)
- **Period and perimenopause symptoms.** In a survey of 1,114 women who swim in cold water, close to half said it eased anxiety, over a third said mood swings and irritability, and about 30% of perimenopausal women said hot flushes. Survey only, no controls. Early. [Detail](#women-period-and-perimenopause-symptoms) · [[34]](https://pubmed.ncbi.nlm.nih.gov/38271095/)
- **Women carry more brown fat.** Brown fat shows up on scans more than twice as often in women as in men, with more mass and activity, and women's brown fat responds more strongly to cold. Whether plunging changes that is untested. Early. [Detail](#women-brown-fat-and-metabolism) · [[42]](https://pubmed.ncbi.nlm.nih.gov/19357406/) [[41]](https://pubmed.ncbi.nlm.nih.gov/32508310/)
- **Low iron makes cold harder.** Women with iron-deficiency anaemia, which is common with heavy periods, could not hold core temperature as well in cool water. Iron treatment helped. Early, but a useful check-in for a guest who feels the cold badly. [Detail](#women-iron-thyroid-and-raynauds) · [[43]](https://pubmed.ncbi.nlm.nih.gov/2239756/)
- **Thyroid and hormones.** Twelve weeks of winter swimming did not disturb thyroid hormones in healthy women, in a very small study. Early. [[44]](https://pubmed.ncbi.nlm.nih.gov/19444973/)
- **Raynaud's is more common in women.** Cold triggers attacks, so guests with it should keep hands and feet out of the plunge or skip it. [[46]](https://pubmed.ncbi.nlm.nih.gov/25776043/)
- **Pregnancy, postpartum, fertility.** There is no physiological study of cold plunging in pregnancy or after birth, and none on fertility in either direction. Healthy pregnant women in Finland sauna routinely, per a 1988 review. Doctor or midwife first. [Detail](#women-pregnancy-postpartum-and-fertility) · [[47]](https://pubmed.ncbi.nlm.nih.gov/3218901/) [[48]](https://pubmed.ncbi.nlm.nih.gov/41270331/)

### Sauna and cold together at a glance

- **Move calmly between them.** Going from heat to cold produces the biggest hormone surge and the most strain on the heart of any protocol tested. Never rush from the hottest bench straight into the plunge. Moderate (small, older studies). [Detail](#sauna-and-cold-together) · [[25]](https://pubmed.ncbi.nlm.nih.gov/2736002/) [[26]](https://pubmed.ncbi.nlm.nih.gov/2789570/)
- **Contrast for recovery.** Alternating hot and cold reduces soreness after exercise, but no better than cold alone. Moderate. [[27]](https://pubmed.ncbi.nlm.nih.gov/23626806/)

### Safety at a glance

- **No alcohol.** About half of sauna deaths in Finland involved alcohol. [Detail](#safety-what-the-research-says) · [[29]](https://pubmed.ncbi.nlm.nih.gov/18471223/)
- **Cold shock is the real risk of the plunge.** The gasp and racing heart in the first minute can trigger arrhythmias in people with heart disease, including undiagnosed. Enter slowly, face out of the water, breathe steadily. [[30]](https://pubmed.ncbi.nlm.nih.gov/28833689/) [[31]](https://pubmed.ncbi.nlm.nih.gov/22547634/)
- **Build up gradually.** Regular, graded exposure by healthy people looks beneficial; unaccustomed people carry the highest risk. [[32]](https://pubmed.ncbi.nlm.nih.gov/31702722/) [[33]](https://pubmed.ncbi.nlm.nih.gov/33276648/)
- **Hydrate and sit before you stand.** Dizziness, dehydration, and headache are the common minor reactions. [[10]](https://pubmed.ncbi.nlm.nih.gov/31126560/)
- **Doctor first** for pregnancy, heart conditions, uncontrolled blood pressure, Raynaud's, or recent illness. Never sauna or plunge alone or intoxicated.

### What to say to guests

- "Regular sauna use is linked to lower rates of heart disease, stroke, and dementia in long-term studies. It's not a treatment, but the pattern is consistent."
- "The plunge gives you a big burst of noradrenaline and dopamine. That's the clear-headed feeling. Studies show lower stress the next day and better mood right after."
- "If you're lifting for muscle, do the plunge on a different day or wait a few hours. Cold right after strength training can blunt your gains."
- "Go into the water slowly and keep breathing. The first thirty seconds are the hard part, and that's the cold shock passing."
- "Hydrate, cool down sitting before you stand, and skip the sauna if you've been drinking."
- "Most of the cold research was done on men, but the mood and alertness effects show up in women too. Where there is a difference it's body fat, not sex: more insulation means slower cooling."
- "You don't need to time plunges to your cycle. Direct tests found no difference across the month."
- "A lot of women swimmers say cold helps with period and perimenopause symptoms, especially anxiety and hot flushes. That's from a survey rather than a trial, but it's a common report."
- "If you feel the cold much worse than you'd expect, low iron is worth checking. It measurably affects how well you hold your temperature."
- "There's no research on cold plunging in pregnancy, so talk to your doctor or midwife first."

## The science in depth

Two things to keep in mind when you repeat any of this:

- **Association is not proof.** Most of the strongest sauna findings come from one long-running Finnish cohort (the Kuopio Ischaemic Heart Disease study, roughly 2,300 middle-aged men followed for over 20 years). People who sauna more may differ in other ways, and the researchers adjust for what they can, but these studies show a link, not a guarantee.
- **Cold plunge research is younger and smaller.** Many cold studies have a few dozen participants and short follow-up. The 2025 meta-analysis pooled only 11 randomised trials [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/).

## Sauna

### Sauna: heart and circulation

- **Lower cardiovascular and overall mortality.** In the Finnish cohort, men who used the sauna 4 to 7 times a week had a 63% lower rate of sudden cardiac death than men who went once a week (hazard ratio 0.37). Over the follow-up period, 30.8% of the frequent group died of any cause versus 49.1% of the once-a-week group. Sessions over 19 minutes were also linked to lower risk than sessions under 11 minutes [[1]](https://pubmed.ncbi.nlm.nih.gov/25705824/).
- **The same pattern holds for women.** A later study of 1,688 men and women (about half women, mean age 63) found 4 to 7 sessions a week was linked to roughly 70% lower cardiovascular mortality than one session a week, and adding sauna frequency improved standard risk prediction models [[2]](https://pubmed.ncbi.nlm.nih.gov/30486813/).
- **Lower risk of stroke.** Among 1,628 men and women, 4 to 7 sessions a week was linked to a 61% lower risk of stroke than one session a week (hazard ratio 0.39) [[3]](https://pubmed.ncbi.nlm.nih.gov/29720543/).
- **Lower risk of developing high blood pressure.** Among 1,621 men without hypertension at baseline, frequent sauna use was linked to roughly half the risk of developing it over 25 years (hazard ratio 0.53 to 0.54) [[4]](https://pubmed.ncbi.nlm.nih.gov/28633297/).
- **What a single session does.** In 102 adults with at least one cardiovascular risk factor, one 30-minute session at 163°F lowered systolic blood pressure from 137 to 130 mmHg and diastolic from 82 to 75, and reduced arterial stiffness (pulse wave velocity 9.8 to 8.6 m/s). Blood pressure stayed lower through 30 minutes of recovery. Heart rate rose from 65 to 81 bpm, comparable to a brisk walk [[5]](https://pubmed.ncbi.nlm.nih.gov/29048215/).

### Sauna: brain

- **Lower risk of dementia.** In the Finnish cohort, 4 to 7 sessions a week was linked to a 66% lower risk of dementia (hazard ratio 0.34) and a 65% lower risk of Alzheimer's disease (hazard ratio 0.35) compared with once a week [[6]](https://pubmed.ncbi.nlm.nih.gov/27932366/).
- **Lower risk of psychotic disorders.** Among 2,138 men, frequent sauna use was linked to roughly a 78% lower risk of being diagnosed with a psychotic disorder over 25 years (hazard ratio 0.21 to 0.23) [[7]](https://pubmed.ncbi.nlm.nih.gov/30173212/).
- **Heat and depression.** A small, sham-controlled trial found a single session of whole-body hyperthermia reduced depression scores for up to six weeks. It used a medical infrared hyperthermia device rather than a conventional sauna and only 29 people were analysed, so treat this as promising, not proven [[8]](https://pubmed.ncbi.nlm.nih.gov/27172277/).

### Sauna: lungs

- **Fewer respiratory illnesses.** Among 1,935 men, four or more sessions a week was linked to a 41% lower risk of hospital-diagnosed pneumonia, asthma, or COPD than one session or fewer (hazard ratio 0.59) [[9]](https://pubmed.ncbi.nlm.nih.gov/28905164/).

### Sauna: sleep, relaxation, and well-being

- **Most regular users report better sleep.** In a global survey of 482 sauna bathers, 83.5% reported sleep benefits, and the top reasons people gave for going were relaxation, stress reduction, pain relief, and socialising. This is self-reported and self-selected, so it tells us what people experience rather than proving an effect [[10]](https://pubmed.ncbi.nlm.nih.gov/31126560/).
- **The broad picture.** A 2018 systematic review of 40 clinical studies (3,855 participants) found regular dry sauna bathing is associated with benefits for cardiovascular health, rheumatic conditions, and quality of life, with very few adverse events reported. Most of the underlying studies were small [[11]](https://pubmed.ncbi.nlm.nih.gov/29849692/).

### Sauna: how it may work

Reviews in the Mayo Clinic Proceedings and Experimental Gerontology describe sauna as a form of mild, repeated stress that the body adapts to: improved endothelial function, reduced arterial stiffness, a shift toward parasympathetic (rest-and-digest) activity after the session, better cholesterol profiles, lower blood pressure, and production of heat shock proteins that help cells repair damaged proteins [[12]](https://pubmed.ncbi.nlm.nih.gov/30077204/) [[13]](https://pubmed.ncbi.nlm.nih.gov/34363927/). The cardiovascular load of a session resembles moderate exercise, which is part of why the effects look similar.

## Cold plunging

### Cold: stress hormones and alertness

- **A large, immediate hormonal response.** An hour of head-out immersion at 57°F raised noradrenaline by 530% and dopamine by 250%, and increased metabolic rate by 350%. This is the physiological basis for the alert, energised feeling after a plunge [[14]](https://pubmed.ncbi.nlm.nih.gov/10751106/).
- **Lower stress the next day.** The 2025 meta-analysis of 11 randomised trials (3,177 participants, water 45 to 59°F) found reduced perceived stress 12 hours after immersion. Inflammation markers rose immediately after and at one hour, which is the expected short-term stress response, not harm. The review found no significant pooled effect on immune function or mood [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/).

### Cold: mood

- **A single plunge improves mood.** In 64 students, a single immersion of up to 20 minutes in 56.5°F seawater cut total mood disturbance scores from 51 to 36, with less tension, anger, depression, fatigue, and confusion and more vigour. Non-immersed controls did not change [[16]](https://doi.org/10.1002/lim2.53).
- **Measurable changes in the brain.** A 2023 brain-imaging study found five minutes of cold immersion left participants feeling more active, alert, attentive, and inspired, and less distressed, with increased coupling between brain networks involved in attention and emotion [[17]](https://pubmed.ncbi.nlm.nih.gov/36829490/).
- **Regular winter swimmers feel better over a season.** After four months of winter swimming, swimmers reported less tension, fatigue, and negative mood and more vigour than non-swimming controls. Swimmers with rheumatism, fibromyalgia, or asthma all reported pain relief, though this was self-reported and unblinded [[18]](https://pubmed.ncbi.nlm.nih.gov/15253480/).

### Cold: immunity and sick days

- **Fewer sick days, not fewer illnesses.** In a randomised trial of 3,018 adults, finishing a daily shower with 30 to 90 seconds of cold water for 30 days cut self-reported sickness absence from work by 29%. People got sick just as often but took less time off, which suggests the effect is on how people cope rather than on infection itself [[19]](https://pubmed.ncbi.nlm.nih.gov/27631616/).
- **A trained stress response can dampen inflammation.** In a 24-person study, people trained for 10 days in breathing exercises, meditation, and cold exposure (including ice-water immersion) produced more adrenaline and fewer inflammatory cytokines when injected with bacterial endotoxin, and reported fewer flu-like symptoms. The authors attributed most of the effect to the breathing technique, with cold as one of three components [[20]](https://pubmed.ncbi.nlm.nih.gov/24799686/).

### Cold: muscles and recovery

- **Less soreness after hard exercise.** A Cochrane review of 17 trials found cold water immersion reduced muscle soreness at 24, 48, 72, and 96 hours after exercise compared with rest. Evidence quality was rated low [[21]](https://pubmed.ncbi.nlm.nih.gov/22336838/).
- **But it can blunt strength gains.** In a 12-week trial, men who did a 10-minute cold plunge after every strength session gained less muscle and strength than men who did light active recovery instead. If a guest is training for muscle growth, suggest plunging on a separate day or several hours after lifting [[22]](https://pubmed.ncbi.nlm.nih.gov/26174323/).

### Cold: metabolism

- **Cold activates brown fat.** Ten days of mild cold exposure increased brown fat activity and heat production in healthy adults [[23]](https://pubmed.ncbi.nlm.nih.gov/23867626/). In eight people with type 2 diabetes, the same protocol improved insulin sensitivity by about 43% [[24]](https://pubmed.ncbi.nlm.nih.gov/26147760/). Both used cool air (57 to 61°F) rather than water immersion and were very small, so they show a mechanism rather than a proven benefit of plunging.

## Cold plunging for women

Staff get more questions about this than almost anything else, and the honest answer has three parts: the general benefits apply, the differences that exist come mostly from body composition rather than sex, and several of the specific questions women ask (pregnancy, fertility, menopause) have little or no direct research behind them.

### Women: what the research covers

- **The evidence base skews male.** Across 5,261 sport and exercise science papers from 2014 to 2020, 31% were men-only, 6% women-only, and women made up 34% of participants [[49]](https://doi.org/10.1123/wspaj.2021-0028). Reviews of cold physiology in women describe the area as "relatively understudied" [[38]](https://pubmed.ncbi.nlm.nih.gov/35655670/).
- **The headline benefits were shown in mixed groups.** The single-plunge mood study (64 students), the cold shower trial (3,018 adults), and the 2025 meta-analysis all included women, so there is no reason to think the mood, stress, and alertness findings are men-only [[16]](https://doi.org/10.1002/lim2.53) [[19]](https://pubmed.ncbi.nlm.nih.gov/27631616/) [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/).
- **Women who swim in cold water do so year-round.** In the largest survey, 89% of 1,114 women swam through winter, typically 5 to 15 minutes per swim in the coldest months, mostly in swimsuits rather than wetsuits [[35]](https://pubmed.ncbi.nlm.nih.gov/39168149/).

### Women: cooling, body composition, and cold shock

- **Body fat is the main variable.** In 64°F water, women's core temperature fell at about half the men's rate (0.85°F per hour). When the researchers compared men and women of matched body fatness, the difference disappeared. Cooling rate tracked the ratio of skin surface to body mass; shivering tracked inversely with body fat [[36]](https://pubmed.ncbi.nlm.nih.gov/11007575/).
- **Different strategies, same result.** In 57°F water, men and women cooled at the same rate, but got there differently: women relied more on insulation (skin blood vessels clamping down), men on shivering and metabolic heat. Men also showed larger adrenaline and inflammatory responses despite feeling equally cold [[37]](https://pubmed.ncbi.nlm.nih.gov/24809633/).
- **The synthesis.** A 2022 review concludes that sex differences in cold tolerance are minimal once body size and composition are accounted for, so women have no overall advantage or disadvantage in the cold [[38]](https://pubmed.ncbi.nlm.nih.gov/35655670/).
- **Cold shock.** No study has compared the initial gasp-and-racing-heart response between men and women as a primary outcome, so give women the same advice as everyone: enter slowly, face out of the water, breathe steadily [[30]](https://pubmed.ncbi.nlm.nih.gov/28833689/).

### Women: the menstrual cycle

- **Core temperature shifts across the cycle.** It runs 0.5 to 1.3°F higher in the luteal phase (after ovulation), when progesterone is high, and oestrogen and progesterone move the thresholds at which the body starts constricting or dilating skin blood vessels [[39]](https://pubmed.ncbi.nlm.nih.gov/33123618/) [[38]](https://pubmed.ncbi.nlm.nih.gov/35655670/).
- **But cold immersion responses do not change.** Women tested in 68°F water in both the follicular and luteal phases responded the same in both, and the same as men. The authors concluded that "when faced with a cold challenge, women respond similarly to men in both phases of their menstrual cycle" [[40]](https://pubmed.ncbi.nlm.nih.gov/10902935/).
- **One signal in brown fat.** Women's brown fat warmed more in response to a cold hand-bath than men's in either phase, with a smaller rise in the follicular phase. Small study, indirect measurement [[41]](https://pubmed.ncbi.nlm.nih.gov/32508310/).
- **Practical read.** There is no evidence that plunges need to be timed to the cycle. A guest who feels the cold more on some days than others is not imagining it, but the studies say the plunge itself is safe throughout.

### Women: period and perimenopause symptoms

- **What women report.** An online survey of 1,114 women who swim in cold water found that, among those with menstrual symptoms, 46.7% said swimming reduced anxiety, 37.7% mood swings, and 37.6% irritability. Among perimenopausal women, 46.9% reported less anxiety, 34.5% fewer mood swings, 31.1% less low mood, and 30.3% fewer hot flushes. More than half said they swim specifically for these symptoms [[34]](https://pubmed.ncbi.nlm.nih.gov/38271095/).
- **How much to trust it.** This is self-report from a self-selected group recruited through cold-swimming communities, with no control group. The authors note that other forms of exercise might show the same. It is the only study on cold water and menopause that exists, so present it as "many women report," never as "cold water treats."

### Women: brown fat and metabolism

- **Women have more brown fat.** In a review of 1,972 patients' PET scans, active brown fat was seen in 7.5% of women versus 3.1% of men, and women's deposits were larger and more active. These were clinical scans done for other reasons, so this shows women have more detectable brown fat, not that plunging builds it [[42]](https://pubmed.ncbi.nlm.nih.gov/19357406/).
- **A season of cold swimming and insulin.** Fourteen women (mean age 45) who swam outdoors at least twice a week over seven months showed improved insulin sensitivity and lower insulin and leptin. No control group, and the season itself may explain part of it [[45]](https://pubmed.ncbi.nlm.nih.gov/27376416/).

### Women: iron, thyroid, and Raynaud's

- **Iron-deficiency anaemia impairs cold defence.** In 82°F water, anaemic women could not hold their core temperature or raise their metabolism as well as iron-replete women matched for body fat, and their thyroid hormones were lower. Iron supplementation corrected the anaemia and improved their temperature response. Small (30 women) and the water was mild by plunge standards, but the mechanism is clear enough to matter for a guest with heavy periods who feels the cold badly [[43]](https://pubmed.ncbi.nlm.nih.gov/2239756/).
- **Thyroid hormones stay normal.** Six healthy women who winter-swam three times a week for 12 weeks showed a brief rise in TSH that stayed within the normal range and no change in thyroid hormones. Very small, so treat as reassuring rather than conclusive [[44]](https://pubmed.ncbi.nlm.nih.gov/19444973/).
- **Raynaud's.** Primary Raynaud's phenomenon affects roughly 5% of people, and women are about 1.65 times as likely to have it as men. Cold is the classic trigger. A guest who mentions white or blue fingers in the cold should keep hands and feet out of the water or skip the plunge [[46]](https://pubmed.ncbi.nlm.nih.gov/25776043/).

### Women: pregnancy, postpartum, and fertility

- **Pregnancy and cold water: no physiological research.** The only study is a qualitative one in which 13 pregnant and 5 postpartum women who sea-swam through a British winter described eased aches and protected time for themselves. No measurements, no controls, no safety data [[48]](https://pubmed.ncbi.nlm.nih.gov/41270331/). Say plainly that the evidence does not exist and send the guest to their doctor or midwife.
- **Pregnancy and sauna.** A Finnish review found healthy pregnant women's circulatory responses to sauna match non-pregnant women's, foetal heart tracings stayed normal, and the authors concluded healthy women may sauna throughout pregnancy. It is a 1988 narrative review, not a trial [[47]](https://pubmed.ncbi.nlm.nih.gov/3218901/).
- **Fertility.** No peer-reviewed study of cold water immersion and women's fertility exists in either direction.

## Sauna and cold together

The classic Finnish pattern of heat followed by cold has less direct research than either practice alone.

- **Physiology of the combination.** Studies of winter swimmers found sauna lowers peripheral resistance and cold raises it, and alternating the two produced the largest catecholamine release and the greatest strain on the heart of any protocol tested. This is why we ask guests to move calmly and never rush from the hottest bench straight into the plunge [[25]](https://pubmed.ncbi.nlm.nih.gov/2736002/) [[26]](https://pubmed.ncbi.nlm.nih.gov/2789570/).
- **Contrast therapy for recovery.** A meta-analysis of 18 trials found alternating hot and cold water reduced muscle soreness and strength loss after exercise compared with passive rest, but was no better than cold alone, warm water, compression, or active recovery [[27]](https://pubmed.ncbi.nlm.nih.gov/23626806/).
- **Sleep.** The best controlled trial on cold immersion and sleep (11 cyclists, evening plunge after exercise) found no change in any sleep measure [[28]](https://pubmed.ncbi.nlm.nih.gov/23377833/). Better sleep after sauna is widely reported by users but has not been tested in a rigorous trial. Say "many people find they sleep better" rather than "it improves sleep."

## Safety: what the research says

- **Alcohol and heat do not mix.** A review of every sauna death in Finland from 1990 to 2002 found about half of the deceased were under the influence of alcohol. The authors' advice: less drinking, and never leave an intoxicated bather alone in the sauna [[29]](https://pubmed.ncbi.nlm.nih.gov/18471223/).
- **Cold shock is the main risk of the plunge.** Sudden immersion triggers an involuntary gasp, rapid breathing, and a spike in heart rate and blood pressure. For most healthy people this passes within a minute or two. For people with known or undiagnosed heart disease it can trigger arrhythmias, particularly when the gasp reflex and the breath-hold diving reflex fire at the same time, a mechanism researchers call "autonomic conflict" [[30]](https://pubmed.ncbi.nlm.nih.gov/28833689/) [[31]](https://pubmed.ncbi.nlm.nih.gov/22547634/).
- **Acclimate gradually.** Reviews of winter swimming agree that regular, graded exposure by healthy people appears beneficial, while unaccustomed people face the highest risk. Recommend first-timers enter slowly, keep their face out of the water, breathe steadily, and stay in for seconds rather than minutes [[32]](https://pubmed.ncbi.nlm.nih.gov/31702722/) [[33]](https://pubmed.ncbi.nlm.nih.gov/33276648/).
- **Common minor reactions.** In the global sauna survey, 93% of reported adverse reactions were minor: dizziness, dehydration, and headache. Encourage water before and after, and a seated cool-down before standing up quickly [[10]](https://pubmed.ncbi.nlm.nih.gov/31126560/).
- **Standard precautions.** These are clinical common sense rather than findings from a specific study: guests who are pregnant, have a heart condition, uncontrolled blood pressure, Raynaud's, or a recent illness should check with their doctor before using the sauna or plunge, and no one should sauna or plunge while intoxicated or alone.

## References

1. Laukkanen T, Khan H, Zaccardi F, Laukkanen JA. Association between sauna bathing and fatal cardiovascular and all-cause mortality events. *JAMA Intern Med.* 2015;175(4):542-548. [PubMed](https://pubmed.ncbi.nlm.nih.gov/25705824/)
2. Laukkanen T, Kunutsor SK, Khan H, et al. Sauna bathing is associated with reduced cardiovascular mortality and improves risk prediction in men and women: a prospective cohort study. *BMC Med.* 2018;16:219. [PubMed](https://pubmed.ncbi.nlm.nih.gov/30486813/)
3. Kunutsor SK, Khan H, Zaccardi F, et al. Sauna bathing reduces the risk of stroke in Finnish men and women: A prospective cohort study. *Neurology.* 2018;90(22):e1937-e1944. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29720543/)
4. Zaccardi F, Laukkanen T, Willeit P, et al. Sauna Bathing and Incident Hypertension: A Prospective Cohort Study. *Am J Hypertens.* 2017;30(11):1120-1125. [PubMed](https://pubmed.ncbi.nlm.nih.gov/28633297/)
5. Lee E, Laukkanen T, Kunutsor SK, et al. Sauna exposure leads to improved arterial compliance: Findings from a non-randomised experimental study. *Eur J Prev Cardiol.* 2018;25(2):130-138. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29048215/)
6. Laukkanen T, Kunutsor S, Kauhanen J, Laukkanen JA. Sauna bathing is inversely associated with dementia and Alzheimer's disease in middle-aged Finnish men. *Age Ageing.* 2017;46(2):245-249. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27932366/)
7. Laukkanen T, Laukkanen JA, Kunutsor SK. Sauna Bathing and Risk of Psychotic Disorders: A Prospective Cohort Study. *Med Princ Pract.* 2018;27(6):562-569. [PubMed](https://pubmed.ncbi.nlm.nih.gov/30173212/)
8. Janssen CW, Lowry CA, Mehl MR, et al. Whole-Body Hyperthermia for the Treatment of Major Depressive Disorder: A Randomized Clinical Trial. *JAMA Psychiatry.* 2016;73(8):789-795. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27172277/)
9. Kunutsor SK, Laukkanen T, Laukkanen JA. Sauna bathing reduces the risk of respiratory diseases: a long-term prospective cohort study. *Eur J Epidemiol.* 2017;32(12):1107-1111. [PubMed](https://pubmed.ncbi.nlm.nih.gov/28905164/)
10. Hussain JN, Greaves RF, Cohen MM. A hot topic for health: Results of the Global Sauna Survey. *Complement Ther Med.* 2019;44:223-234. [PubMed](https://pubmed.ncbi.nlm.nih.gov/31126560/)
11. Hussain J, Cohen M. Clinical Effects of Regular Dry Sauna Bathing: A Systematic Review. *Evid Based Complement Alternat Med.* 2018;2018:1857413. [PubMed](https://pubmed.ncbi.nlm.nih.gov/29849692/)
12. Laukkanen JA, Laukkanen T, Kunutsor SK. Cardiovascular and Other Health Benefits of Sauna Bathing: A Review of the Evidence. *Mayo Clin Proc.* 2018;93(8):1111-1121. [PubMed](https://pubmed.ncbi.nlm.nih.gov/30077204/)
13. Patrick RP, Johnson TL. Sauna use as a lifestyle practice to extend healthspan. *Exp Gerontol.* 2021;154:111509. [PubMed](https://pubmed.ncbi.nlm.nih.gov/34363927/)
14. Šrámek P, Šimečková M, Janský L, Šavlíková J, Vybíral S. Human physiological responses to immersion into water of different temperatures. *Eur J Appl Physiol.* 2000;81(5):436-442. [PubMed](https://pubmed.ncbi.nlm.nih.gov/10751106/)
15. Cain T, Brinsley J, Bennett H, Nelson M, Maher C, Singh B. Effects of cold-water immersion on health and wellbeing: A systematic review and meta-analysis. *PLoS One.* 2025;20(1):e0317615. [PubMed](https://pubmed.ncbi.nlm.nih.gov/39879231/)
16. Kelly JS, Bird E. Improved mood following a single immersion in cold water. *Lifestyle Med.* 2022;3(1):e53. [DOI](https://doi.org/10.1002/lim2.53)
17. Yankouskaya A, Williamson R, Stacey C, Totman JJ, Massey H. Short-Term Head-Out Whole-Body Cold-Water Immersion Facilitates Positive Affect and Increases Interaction between Large-Scale Brain Networks. *Biology (Basel).* 2023;12(2):211. [PubMed](https://pubmed.ncbi.nlm.nih.gov/36829490/)
18. Huttunen P, Kokko L, Ylijukuri V. Winter swimming improves general well-being. *Int J Circumpolar Health.* 2004;63(2):140-144. [PubMed](https://pubmed.ncbi.nlm.nih.gov/15253480/)
19. Buijze GA, Sierevelt IN, van der Heijden BC, Dijkgraaf MG, Frings-Dresen MH. The Effect of Cold Showering on Health and Work: A Randomized Controlled Trial. *PLoS One.* 2016;11(9):e0161749. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27631616/)
20. Kox M, van Eijk LT, Zwaag J, et al. Voluntary activation of the sympathetic nervous system and attenuation of the innate immune response in humans. *Proc Natl Acad Sci USA.* 2014;111(20):7379-7384. [PubMed](https://pubmed.ncbi.nlm.nih.gov/24799686/)
21. Bleakley C, McDonough S, Gardner E, et al. Cold-water immersion (cryotherapy) for preventing and treating muscle soreness after exercise. *Cochrane Database Syst Rev.* 2012;(2):CD008262. [PubMed](https://pubmed.ncbi.nlm.nih.gov/22336838/)
22. Roberts LA, Raastad T, Markworth JF, et al. Post-exercise cold water immersion attenuates acute anabolic signalling and long-term adaptations in muscle to strength training. *J Physiol.* 2015;593(18):4285-4301. [PubMed](https://pubmed.ncbi.nlm.nih.gov/26174323/)
23. van der Lans AA, Hoeks J, Brans B, et al. Cold acclimation recruits human brown fat and increases nonshivering thermogenesis. *J Clin Invest.* 2013;123(8):3395-3403. [PubMed](https://pubmed.ncbi.nlm.nih.gov/23867626/)
24. Hanssen MJ, Hoeks J, Brans B, et al. Short-term cold acclimation improves insulin sensitivity in patients with type 2 diabetes mellitus. *Nat Med.* 2015;21(8):863-865. [PubMed](https://pubmed.ncbi.nlm.nih.gov/26147760/)
25. Kauppinen K. Sauna, shower, and ice water immersion. Physiological responses to brief exposures to heat, cool, and cold. Part II. Circulation. *Arctic Med Res.* 1989;48(2):64-74. [PubMed](https://pubmed.ncbi.nlm.nih.gov/2736002/)
26. Kauppinen K, Pajari-Backas M, Volin P, Vakkuri O. Some endocrine responses to sauna, shower and ice water immersion. *Arctic Med Res.* 1989;48(3):131-139. [PubMed](https://pubmed.ncbi.nlm.nih.gov/2789570/)
27. Bieuzen F, Bleakley CM, Costello JT. Contrast water therapy and exercise induced muscle damage: a systematic review and meta-analysis. *PLoS One.* 2013;8(4):e62356. [PubMed](https://pubmed.ncbi.nlm.nih.gov/23626806/)
28. Robey E, Dawson B, Halson S, et al. Effect of evening postexercise cold water immersion on subsequent sleep. *Med Sci Sports Exerc.* 2013;45(7):1394-1402. [PubMed](https://pubmed.ncbi.nlm.nih.gov/23377833/)
29. Kenttämies A, Karkola K. Death in sauna. *J Forensic Sci.* 2008;53(3):724-729. [PubMed](https://pubmed.ncbi.nlm.nih.gov/18471223/)
30. Tipton MJ, Collier N, Massey H, Corbett J, Harper M. Cold water immersion: kill or cure? *Exp Physiol.* 2017;102(11):1335-1355. [PubMed](https://pubmed.ncbi.nlm.nih.gov/28833689/)
31. Shattock MJ, Tipton MJ. 'Autonomic conflict': a different way to die during cold water immersion? *J Physiol.* 2012;590(14):3219-3230. [PubMed](https://pubmed.ncbi.nlm.nih.gov/22547634/)
32. Manolis AS, Manolis SA, Manolis AA, Manolis TA, Apostolaki N, Melita H. Winter Swimming: Body Hardening and Cardiorespiratory Protection Via Sustainable Acclimation. *Curr Sports Med Rep.* 2019;18(11):401-415. [PubMed](https://pubmed.ncbi.nlm.nih.gov/31702722/)
33. Knechtle B, Waśkiewicz Z, Sousa CV, Hill L, Nikolaidis PT. Cold Water Swimming: Benefits and Risks: A Narrative Review. *Int J Environ Res Public Health.* 2020;17(23):8984. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33276648/)
34. Pound M, Massey H, Roseneil S, et al. How do women feel cold water swimming affects their menstrual and perimenopausal symptoms? *Post Reprod Health.* 2024;30(1):11-27. [PubMed](https://pubmed.ncbi.nlm.nih.gov/38271095/)
35. Pound M, Massey H, Roseneil S, et al. The swimming habits of women who cold water swim. *Womens Health (Lond).* 2024;20:17455057241265080. [PubMed](https://pubmed.ncbi.nlm.nih.gov/39168149/)
36. Tikuisis P, Jacobs I, Moroz D, Vallerand AL, Martineau L. Comparison of thermoregulatory responses between men and women immersed in cold water. *J Appl Physiol.* 2000;89(4):1403-1411. [PubMed](https://pubmed.ncbi.nlm.nih.gov/11007575/)
37. Solianik R, Skurvydas A, Vitkauskienė A, Brazaitis M. Gender-specific cold responses induce a similar body-cooling rate but different neuroendocrine and immune responses. *Cryobiology.* 2014;69(1):26-33. [PubMed](https://pubmed.ncbi.nlm.nih.gov/24809633/)
38. Greenfield AM, Charkoudian N, Alba BK. Influences of ovarian hormones on physiological responses to cold in women. *Temperature (Austin).* 2022;9(1):23-45. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35655670/)
39. Baker FC, Siboza F, Fuller A. Temperature regulation in women: Effects of the menstrual cycle. *Temperature (Austin).* 2020;7(3):226-262. [PubMed](https://pubmed.ncbi.nlm.nih.gov/33123618/)
40. Glickman-Weiss EL, Cheatham C, Caine N, et al. The influence of gender and menstrual phase on thermosensitivity during cold water immersion. *Aviat Space Environ Med.* 2000;71(7):715-722. [PubMed](https://pubmed.ncbi.nlm.nih.gov/10902935/)
41. Fuller-Jackson JP, Dordevic AL, Clarke IJ, Henry BA. Effect of sex and sex steroids on brown adipose tissue heat production in humans. *Eur J Endocrinol.* 2020;183(3):343-355. [PubMed](https://pubmed.ncbi.nlm.nih.gov/32508310/)
42. Cypess AM, Lehman S, Williams G, et al. Identification and importance of brown adipose tissue in adult humans. *N Engl J Med.* 2009;360(15):1509-1517. [PubMed](https://pubmed.ncbi.nlm.nih.gov/19357406/)
43. Beard JL, Borel MJ, Derr J. Impaired thermoregulation and thyroid function in iron-deficiency anemia. *Am J Clin Nutr.* 1990;52(5):813-819. [PubMed](https://pubmed.ncbi.nlm.nih.gov/2239756/)
44. Smolander J, Leppäluoto J, Westerlund T, et al. Effects of repeated whole-body cold exposures on serum concentrations of growth hormone, thyrotropin, prolactin and thyroid hormones in healthy women. *Cryobiology.* 2009;58(3):275-278. [PubMed](https://pubmed.ncbi.nlm.nih.gov/19444973/)
45. Gibas-Dorna M, Chęcińska Z, Korek E, et al. Variations in leptin and insulin levels within one swimming season in non-obese female cold water swimmers. *Scand J Clin Lab Invest.* 2016;76(6):486-491. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27376416/)
46. Garner R, Kumari R, Lanyon P, Doherty M, Zhang W. Prevalence, risk factors and associations of primary Raynaud's phenomenon: systematic review and meta-analysis of observational studies. *BMJ Open.* 2015;5(3):e006389. [PubMed](https://pubmed.ncbi.nlm.nih.gov/25776043/)
47. Vähä-Eskeli K, Erkkola R. The sauna and pregnancy. *Ann Clin Res.* 1988;20(4):279-282. [PubMed](https://pubmed.ncbi.nlm.nih.gov/3218901/)
48. McGrath E, Shawe J. Sea swimming during pregnancy and matrescence: Embodiment, experiences and the environment. *Health Place.* 2025;96:103551. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41270331/)
49. Cowley ES, Olenick AA, McNulty KL, Ross EZ. "Invisible Sportswomen": The Sex Data Gap in Sport and Exercise Science Research. *Women Sport Phys Act J.* 2021;29(2):146-151. [DOI](https://doi.org/10.1123/wspaj.2021-0028)
$health3$,
    current_version = current_version + 1,
    updated_by = 'seed'
  where slug = 'health-benefits-sauna-cold-plunge'
    and content_md like '%## Quick reference%'
    and content_md like '%°C%'
  returning id, title, content_md, current_version
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, current_version, title, content_md, 'seed',
  'Converted every temperature to Fahrenheit'
from updated;

-- The FAQ section, placed after the existing ones.
insert into public.sop_categories (name, sort_order)
select 'Customer FAQ', coalesce(max(sort_order), -1) + 1
from public.sop_categories
on conflict (name) do nothing;

-- Prose-only (headings and paragraphs, no task lines) so it never registers
-- as a runnable checklist. Access columns are left at their defaults.
with seeded as (
  insert into public.sops
    (slug, title, content_md, category, sort_order, created_by, updated_by)
  values
    (
      'sauna-cold-plunge-faq',
      'Sauna and cold plunge questions',
      $faq$*The questions guests ask most, with answers you can give in plain language. Each answer links to the evidence in the [health benefits guide](/admin/sops/health-benefits-sauna-cold-plunge). Add new questions as they come up and keep answers short and honest about what is known.*

## How long should I stay in the sauna?

**10 to 20 minutes per round, and never past the point of feeling dizzy or unwell.** Step out, cool down, drink water, and go again if you like. Most guests do two to four rounds.

Why: in the long-term Finnish studies, sessions over 19 minutes were linked to lower risk than sessions under 11 minutes, and one 30-minute session at 163°F measurably lowered blood pressure for at least half an hour. Our saunas run hotter, 170 to 195°F, so 10 to 20 minutes here is plenty. Time is less important than listening to your body. [Study](https://pubmed.ncbi.nlm.nih.gov/25705824/) · [Study](https://pubmed.ncbi.nlm.nih.gov/29048215/) · [Guide: sauna at a glance](/admin/sops/health-benefits-sauna-cold-plunge)

## How long should I cold plunge?

**One to three minutes per round. Your first time, 30 seconds to a minute is plenty.** Get out when shivering starts to build rather than trying to beat a number. Build up over visits.

Why: our plunges are kept between 39 and 50°F, which is colder than most research settings (45 to 59°F). The mood and alertness benefits show up quickly: the hormone surge happens in the first minutes, and a single short immersion lifts mood. Experienced winter swimmers work up to 5 to 15 minutes over years, but nobody starts there. [Study](https://pubmed.ncbi.nlm.nih.gov/10751106/) · [Study](https://doi.org/10.1002/lim2.53) · [Guide: cold plunge at a glance](/admin/sops/health-benefits-sauna-cold-plunge)

## What order should I do them in?

**Sauna first, then the plunge, then rest and let your body warm back up on its own before the next round.** Repeat two to four times and finish with whichever feels right: ending on the sauna leaves you relaxed, ending on the plunge leaves you alert.

Why: heat-then-cold is the Finnish tradition, and no study shows a better order for health. What the research does show is that the moment you move from heat to cold is the most intense for your heart and produces the biggest adrenaline surge of any protocol tested, so walk calmly, never rush from the top bench straight into the water, and give yourself a minute between them. [Study](https://pubmed.ncbi.nlm.nih.gov/2736002/) · [Guide: sauna and cold together](/admin/sops/health-benefits-sauna-cold-plunge)

## What are the benefits of sauna?

**Regular sauna use is linked to a healthier heart, lower blood pressure, a lower risk of dementia, fewer lung infections, and better sleep and relaxation.** It is not a treatment for anything, but the pattern across large long-term studies is consistent.

Why: people who sauna four or more times a week had far lower rates of sudden cardiac death, stroke, and dementia than once-a-week users over 20 years of follow-up, and about half the risk of developing high blood pressure. A single session lowers blood pressure and loosens the arteries the way moderate exercise does. Most regular users say they sleep better. [Study](https://pubmed.ncbi.nlm.nih.gov/25705824/) · [Study](https://pubmed.ncbi.nlm.nih.gov/27932366/) · [Review](https://pubmed.ncbi.nlm.nih.gov/30077204/) · [Guide: sauna at a glance](/admin/sops/health-benefits-sauna-cold-plunge)

## What are the benefits of cold plunging?

**A burst of alertness and energy, better mood, lower stress the next day, and less muscle soreness after exercise.** Some people also take fewer sick days. The research here is newer and smaller than for sauna.

Why: cold water sets off a large release of noradrenaline and dopamine, which is the clear-headed feeling afterwards. A single plunge measurably improves mood, a meta-analysis of 11 trials found lower stress 12 hours later, and a trial of 3,000 adults found 29% fewer sick days after a month of cold showers. Sleep benefits have not been shown in a controlled trial, so say "many people find they sleep better" rather than promising it. [Study](https://pubmed.ncbi.nlm.nih.gov/10751106/) · [Meta-analysis](https://pubmed.ncbi.nlm.nih.gov/39879231/) · [Study](https://pubmed.ncbi.nlm.nih.gov/27631616/) · [Guide: cold plunge at a glance](/admin/sops/health-benefits-sauna-cold-plunge)

## Is sauna or cold plunging different for women?

**The benefits are the same. The main physical difference is body composition, not sex, and there is no need to time plunges to the menstrual cycle.** Many women report cold water helps with period and perimenopause symptoms, though that comes from a survey rather than a trial.

Why: women cooled more slowly than men in one study, but the gap disappeared once body fat was matched. Direct tests of cold immersion at different points in the cycle found no difference. In a survey of 1,114 women who swim in cold water, close to half said it eased anxiety and about 30% of perimenopausal women said it eased hot flushes. Two honest gaps: there is no research on cold plunging in pregnancy, and low iron, common with heavy periods, measurably makes the cold harder to handle. A guest who feels the cold far worse than expected may want to get iron checked. [Study](https://pubmed.ncbi.nlm.nih.gov/11007575/) · [Survey](https://pubmed.ncbi.nlm.nih.gov/38271095/) · [Study](https://pubmed.ncbi.nlm.nih.gov/2239756/) · [Guide: cold plunge for women](/admin/sops/health-benefits-sauna-cold-plunge)

## Is there a downside to staying in the plunge too long, or in water that is too cold?

**Yes to both. Longer and colder is not better.** The benefits arrive in the first minutes; the risks grow the longer you stay.

Why: the first minute in cold water triggers the cold shock response, a gasp and a spike in heart rate and blood pressure that is stronger the colder the water and can trigger heart rhythm problems in people with heart disease, including undiagnosed. Staying in past the point of heavy shivering risks hypothermia, and core temperature keeps falling for a while after you get out. Hands and feet numb first, which matters for anyone with Raynaud's. A plunge straight after strength training also blunts muscle gains. Enter slowly, keep your face out, breathe steadily, and get out when shivering builds. Never plunge alone. [Review](https://pubmed.ncbi.nlm.nih.gov/28833689/) · [Study](https://pubmed.ncbi.nlm.nih.gov/22547634/) · [Study](https://pubmed.ncbi.nlm.nih.gov/26174323/) · [Guide: safety](/admin/sops/health-benefits-sauna-cold-plunge)

## Can I sauna or plunge if I'm pregnant or have a heart condition?

**Please check with your doctor first, and we mean that as real advice rather than a disclaimer.** Same for uncontrolled blood pressure, a recent illness, or Raynaud's.

Why: healthy pregnant women in Finland sauna routinely and a review found foetal heart tracings stayed normal, but that is one older review and there is no research at all on cold plunging in pregnancy. For heart conditions, the concern is the cold shock response and the heat-to-cold transition, both of which load the heart. [Review](https://pubmed.ncbi.nlm.nih.gov/3218901/) · [Review](https://pubmed.ncbi.nlm.nih.gov/28833689/) · [Guide: safety](/admin/sops/health-benefits-sauna-cold-plunge)

## Should I plunge after a workout?

**For soreness, yes. For building muscle, wait a few hours or plunge on a different day.**

Why: a Cochrane review found cold water reduces soreness for up to four days after hard exercise. But in a 12-week trial, men who plunged for 10 minutes straight after every strength session gained less muscle and strength than men who did light active recovery. [Review](https://pubmed.ncbi.nlm.nih.gov/22336838/) · [Study](https://pubmed.ncbi.nlm.nih.gov/26174323/) · [Guide: muscles and recovery](/admin/sops/health-benefits-sauna-cold-plunge)

## Can I have a drink before I come?

**No. Alcohol and the sauna are a dangerous mix, and it makes the plunge riskier too.**

Why: in a review of every sauna death in Finland over 12 years, about half of the people who died were under the influence of alcohol. Alcohol blunts your sense of overheating, dehydrates you, and raises the risk of fainting and heart rhythm problems. Hydrate with water before and after instead. [Study](https://pubmed.ncbi.nlm.nih.gov/18471223/) · [Guide: safety](/admin/sops/health-benefits-sauna-cold-plunge)
$faq$,
      'Customer FAQ',
      0,
      'seed',
      'seed'
    )
  on conflict (slug) do nothing
  returning id, title, content_md
)
insert into public.sop_versions (sop_id, version, title, content_md, edited_by, change_note)
select id, 1, title, content_md, 'seed', 'Initial import'
from seeded;
