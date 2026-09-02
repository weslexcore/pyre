-- Seeds a 'Health & Science' section in the SOP library and its first
-- document: a staff reference on the health benefits of sauna bathing and
-- cold water immersion. Every claim in the body cites peer-reviewed research
-- with a clickable PubMed or DOI link (the admin markdown renderer opens
-- off-site links in a new tab), so staff can answer guest questions with
-- sourced information rather than folklore.
--
-- Same access defaults as the other seeds (all roles view, admins edit),
-- prose-only so it never registers as a runnable checklist, and every
-- statement is guarded so a re-run is a no-op.

-- The section, placed after the existing ones.
insert into public.sop_categories (name, sort_order)
select 'Health & Science', coalesce(max(sort_order), -1) + 1
from public.sop_categories
on conflict (name) do nothing;

with seeded as (
  insert into public.sops
    (slug, title, content_md, category, sort_order, created_by, updated_by)
  values
    (
      'health-benefits-sauna-cold-plunge',
      'Health benefits of sauna and cold plunging',
      $health$*What the research actually says, so we can answer guest questions with sources instead of folklore.*

## How to read this

Every claim below links to a peer-reviewed study. Two things to keep in mind when you repeat them:

- **Association is not proof.** Most of the strongest sauna findings come from one long-running Finnish cohort (the Kuopio Ischaemic Heart Disease study, roughly 2,300 middle-aged men followed for over 20 years). People who sauna more may differ in other ways, and the researchers adjust for what they can, but these studies show a link, not a guarantee.
- **Cold plunge research is younger and smaller.** Many cold studies have a few dozen participants and short follow-up. The 2025 meta-analysis of cold water immersion pooled only 11 randomised trials [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/).

When a guest asks, "is this good for me?", the honest answer is: regular sauna is linked to a lot of good outcomes in large studies, cold immersion reliably shifts mood and stress hormones in the short term, and neither is a treatment for any disease. Anyone with a heart condition, on blood pressure medication, or pregnant should talk to their doctor first.

## Sauna

### Heart and circulation

- **Lower cardiovascular and overall mortality.** In the Finnish cohort, men who used the sauna 4 to 7 times a week had a 63% lower rate of sudden cardiac death than men who went once a week (hazard ratio 0.37). Over the follow-up period, 30.8% of the frequent group died of any cause versus 49.1% of the once-a-week group. Sessions over 19 minutes were also linked to lower risk than sessions under 11 minutes [[1]](https://pubmed.ncbi.nlm.nih.gov/25705824/).
- **The same pattern holds for women.** A later study of 1,688 men and women (about half women, mean age 63) found 4 to 7 sessions a week was linked to roughly 70% lower cardiovascular mortality than one session a week, and adding sauna frequency improved standard risk prediction models [[2]](https://pubmed.ncbi.nlm.nih.gov/30486813/).
- **Lower risk of stroke.** Among 1,628 men and women, 4 to 7 sessions a week was linked to a 61% lower risk of stroke than one session a week (hazard ratio 0.39) [[3]](https://pubmed.ncbi.nlm.nih.gov/29720543/).
- **Lower risk of developing high blood pressure.** Among 1,621 men without hypertension at baseline, frequent sauna use was linked to roughly half the risk of developing it over 25 years (hazard ratio 0.53 to 0.54) [[4]](https://pubmed.ncbi.nlm.nih.gov/28633297/).
- **What a single session does.** In 102 adults with at least one cardiovascular risk factor, one 30-minute session at 73°C lowered systolic blood pressure from 137 to 130 mmHg and diastolic from 82 to 75, and reduced arterial stiffness (pulse wave velocity 9.8 to 8.6 m/s). Blood pressure stayed lower through 30 minutes of recovery. Heart rate rose from 65 to 81 bpm, comparable to a brisk walk [[5]](https://pubmed.ncbi.nlm.nih.gov/29048215/).

### Brain

- **Lower risk of dementia.** In the Finnish cohort, 4 to 7 sessions a week was linked to a 66% lower risk of dementia (hazard ratio 0.34) and a 65% lower risk of Alzheimer's disease (hazard ratio 0.35) compared with once a week [[6]](https://pubmed.ncbi.nlm.nih.gov/27932366/).
- **Lower risk of psychotic disorders.** Among 2,138 men, frequent sauna use was linked to roughly a 78% lower risk of being diagnosed with a psychotic disorder over 25 years (hazard ratio 0.21 to 0.23) [[7]](https://pubmed.ncbi.nlm.nih.gov/30173212/).
- **Heat and depression.** A small, sham-controlled trial found a single session of whole-body hyperthermia reduced depression scores for up to six weeks. It used a medical infrared hyperthermia device rather than a conventional sauna and only 29 people were analysed, so treat this as promising, not proven [[8]](https://pubmed.ncbi.nlm.nih.gov/27172277/).

### Lungs

- **Fewer respiratory illnesses.** Among 1,935 men, four or more sessions a week was linked to a 41% lower risk of hospital-diagnosed pneumonia, asthma, or COPD than one session or fewer (hazard ratio 0.59) [[9]](https://pubmed.ncbi.nlm.nih.gov/28905164/).

### Sleep, relaxation, and well-being

- **Most regular users report better sleep.** In a global survey of 482 sauna bathers, 83.5% reported sleep benefits, and the top reasons people gave for going were relaxation, stress reduction, pain relief, and socialising. This is self-reported and self-selected, so it tells us what people experience rather than proving an effect [[10]](https://pubmed.ncbi.nlm.nih.gov/31126560/).
- **The broad picture.** A 2018 systematic review of 40 clinical studies (3,855 participants) found regular dry sauna bathing is associated with benefits for cardiovascular health, rheumatic conditions, and quality of life, with very few adverse events reported. Most of the underlying studies were small [[11]](https://pubmed.ncbi.nlm.nih.gov/29849692/).

### How it may work

Reviews in the Mayo Clinic Proceedings and Experimental Gerontology describe sauna as a form of mild, repeated stress that the body adapts to: improved endothelial function, reduced arterial stiffness, a shift toward parasympathetic (rest-and-digest) activity after the session, better cholesterol profiles, lower blood pressure, and production of heat shock proteins that help cells repair damaged proteins [[12]](https://pubmed.ncbi.nlm.nih.gov/30077204/) [[13]](https://pubmed.ncbi.nlm.nih.gov/34363927/). The cardiovascular load of a session resembles moderate exercise, which is part of why the effects look similar.

## Cold plunging

### Stress hormones and alertness

- **A large, immediate hormonal response.** An hour of head-out immersion at 14°C raised noradrenaline by 530% and dopamine by 250%, and increased metabolic rate by 350%. This is the physiological basis for the alert, energised feeling after a plunge [[14]](https://pubmed.ncbi.nlm.nih.gov/10751106/).
- **Lower stress the next day.** The 2025 meta-analysis of 11 randomised trials (3,177 participants, water 7 to 15°C) found reduced perceived stress 12 hours after immersion. Inflammation markers rose immediately after and at one hour, which is the expected short-term stress response, not harm. The review found no significant pooled effect on immune function or mood [[15]](https://pubmed.ncbi.nlm.nih.gov/39879231/).

### Mood

- **A single plunge improves mood.** In 64 students, a single immersion of up to 20 minutes in 13.6°C seawater cut total mood disturbance scores from 51 to 36, with less tension, anger, depression, fatigue, and confusion and more vigour. Non-immersed controls did not change [[16]](https://doi.org/10.1002/lim2.53).
- **Measurable changes in the brain.** A 2023 brain-imaging study found five minutes of cold immersion left participants feeling more active, alert, attentive, and inspired, and less distressed, with increased coupling between brain networks involved in attention and emotion [[17]](https://pubmed.ncbi.nlm.nih.gov/36829490/).
- **Regular winter swimmers feel better over a season.** After four months of winter swimming, swimmers reported less tension, fatigue, and negative mood and more vigour than non-swimming controls. Swimmers with rheumatism, fibromyalgia, or asthma all reported pain relief, though this was self-reported and unblinded [[18]](https://pubmed.ncbi.nlm.nih.gov/15253480/).

### Immunity and sick days

- **Fewer sick days, not fewer illnesses.** In a randomised trial of 3,018 adults, finishing a daily shower with 30 to 90 seconds of cold water for 30 days cut self-reported sickness absence from work by 29%. People got sick just as often but took less time off, which suggests the effect is on how people cope rather than on infection itself [[19]](https://pubmed.ncbi.nlm.nih.gov/27631616/).
- **A trained stress response can dampen inflammation.** In a 24-person study, people trained for 10 days in breathing exercises, meditation, and cold exposure (including ice-water immersion) produced more adrenaline and fewer inflammatory cytokines when injected with bacterial endotoxin, and reported fewer flu-like symptoms. The authors attributed most of the effect to the breathing technique, with cold as one of three components [[20]](https://pubmed.ncbi.nlm.nih.gov/24799686/).

### Muscles and recovery

- **Less soreness after hard exercise.** A Cochrane review of 17 trials found cold water immersion reduced muscle soreness at 24, 48, 72, and 96 hours after exercise compared with rest. Evidence quality was rated low [[21]](https://pubmed.ncbi.nlm.nih.gov/22336838/).
- **But it can blunt strength gains.** In a 12-week trial, men who did a 10-minute cold plunge after every strength session gained less muscle and strength than men who did light active recovery instead. If a guest is training for muscle growth, suggest plunging on a separate day or several hours after lifting [[22]](https://pubmed.ncbi.nlm.nih.gov/26174323/).

### Metabolism

- **Cold activates brown fat.** Ten days of mild cold exposure increased brown fat activity and heat production in healthy adults [[23]](https://pubmed.ncbi.nlm.nih.gov/23867626/). In eight people with type 2 diabetes, the same protocol improved insulin sensitivity by about 43% [[24]](https://pubmed.ncbi.nlm.nih.gov/26147760/). Both used cool air (14 to 16°C) rather than water immersion and were very small, so they show a mechanism rather than a proven benefit of plunging.

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

## Talking to guests

A few honest lines that match the evidence:

- "Regular sauna use is linked to lower rates of heart disease, stroke, and dementia in long-term studies. It's not a treatment, but the pattern is consistent."
- "The plunge gives you a big burst of noradrenaline and dopamine. That's the clear-headed feeling. Studies show lower stress the next day and better mood right after."
- "If you're lifting for muscle, do the plunge on a different day or wait a few hours. Cold right after strength training can blunt your gains."
- "Go into the water slowly and keep breathing. The first thirty seconds are the hard part, and that's the cold shock passing."
- "Hydrate, cool down sitting before you stand, and skip the sauna if you've been drinking."

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
$health$,
      'Health & Science',
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
